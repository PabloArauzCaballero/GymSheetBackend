import { EXERCISE_SYNONYMS, SynonymGroup } from './exercise-search.synonyms';

/**
 * Búsqueda de ejercicios tolerante (D8): normalización, sinónimos y corrección.
 *
 * Todo aquí es puro: el repositorio traduce el plan a SQL (`pg_trgm`) y el
 * servicio decide la sugerencia con el vocabulario del catálogo.
 */

/** Palabras que no distinguen un ejercicio de otro. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'en', 'a', 'al', 'y', 'o', 'para', 'por', 'un', 'una',
  'the', 'of', 'with', 'and', 'to', 'on', 'in',
]);

const MAX_PHRASE_WORDS = 4;
const MAX_QUERY_GROUPS = 8;

/**
 * Minúsculas, sin acentos y solo letras y números separados por un espacio.
 * Debe dar lo mismo que `public.repp_normalize` (migración 202610130002): es lo
 * que permite comparar lo tecleado con la columna `busqueda`.
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

const synonymIndex: ReadonlyMap<string, SynonymGroup> = (() => {
  const index = new Map<string, SynonymGroup>();
  for (const group of EXERCISE_SYNONYMS) {
    for (const term of group.terms) index.set(normalizeSearchText(term), group);
  }
  return index;
})();

/** Plural regular → singular («dominadas» → «dominada», «flexiones» → «flexion»). */
function singular(word: string): string | null {
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return null;
}

function synonymsOf(phrase: string): SynonymGroup | null {
  const direct = synonymIndex.get(phrase);
  if (direct) return direct;
  const words = phrase.split(' ');
  const last = singular(words[words.length - 1]);
  if (!last) return null;
  const singularPhrase = [...words.slice(0, -1), last].join(' ');
  return synonymIndex.get(singularPhrase) ?? null;
}

/**
 * Una unidad de la consulta: lo que tecleó la persona y todo lo que vale como
 * coincidencia. El ejercicio debe encajar con alguna alternativa de CADA grupo.
 */
export type SearchGroup = {
  /** Palabra o frase tal como se tecleó (normalizada). */
  readonly typed: string;
  /** Alternativas a buscar; la primera es siempre `typed`. */
  readonly alternatives: readonly string[];
  /** Reconocida en el diccionario de sinónimos: no hay nada que corregir. */
  readonly known: boolean;
};

export type SearchPlan = {
  /** Consulta normalizada completa, con las palabras vacías. */
  readonly normalized: string;
  readonly groups: readonly SearchGroup[];
};

/**
 * Trocea la consulta en grupos, prefiriendo la frase más larga que sea un
 * sinónimo conocido («peso muerto» antes que «peso» + «muerto»).
 */
export function planSearch(raw: string): SearchPlan {
  const normalized = normalizeSearchText(raw);
  const words = normalized.split(' ').filter(Boolean);
  const groups: SearchGroup[] = [];
  let index = 0;
  while (index < words.length && groups.length < MAX_QUERY_GROUPS) {
    let matched = false;
    for (let size = Math.min(MAX_PHRASE_WORDS, words.length - index); size >= 1; size -= 1) {
      const phrase = words.slice(index, index + size).join(' ');
      const group = synonymsOf(phrase);
      if (!group) continue;
      groups.push({
        typed: phrase,
        alternatives: unique([phrase, ...group.targets.map(normalizeSearchText)]),
        known: true,
      });
      index += size;
      matched = true;
      break;
    }
    if (matched) continue;
    const word = words[index];
    index += 1;
    if (STOPWORDS.has(word)) continue;
    groups.push({ typed: word, alternatives: [word], known: false });
  }
  return { normalized, groups };
}

/** Alternativas normalizadas de un filtro de texto libre (`equipo`, `musculo`). */
export function expandFilterTerm(raw: string): string[] {
  const normalized = normalizeSearchText(raw);
  if (!normalized) return [];
  const group = synonymsOf(normalized);
  return unique([normalized, ...(group ? group.targets.map(normalizeSearchText) : [])]);
}

/** Palabras de un texto ya normalizado que sirven para buscar (sin las vacías). */
export function significantWords(normalized: string): string[] {
  const words = normalized.split(' ').filter(Boolean);
  const significant = words.filter((word) => !STOPWORDS.has(word));
  // «a» o «y» a solas: mejor buscar eso que no buscar nada.
  return significant.length > 0 ? significant : words;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

// ───────────────────────────────────────────────────────────── «¿Quisiste decir?»

/** Palabra del catálogo: forma normalizada, forma para mostrar y frecuencia. */
export type VocabularyWord = { readonly display: string; readonly count: number };
export type Vocabulary = ReadonlyMap<string, VocabularyWord>;

/** Construye el vocabulario a partir de los nombres del catálogo. */
export function buildVocabulary(names: readonly string[]): Map<string, VocabularyWord> {
  const forms = new Map<string, Map<string, number>>();
  for (const name of names) {
    for (const raw of name.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const key = normalizeSearchText(raw);
      if (key.length < 3 || /^\d+$/u.test(key)) continue;
      const byDisplay = forms.get(key) ?? new Map<string, number>();
      byDisplay.set(raw, (byDisplay.get(raw) ?? 0) + 1);
      forms.set(key, byDisplay);
    }
  }
  const vocabulary = new Map<string, VocabularyWord>();
  for (const [key, byDisplay] of forms) {
    let display = key;
    let best = 0;
    let count = 0;
    for (const [form, seen] of byDisplay) {
      count += seen;
      if (seen > best) {
        best = seen;
        display = form;
      }
    }
    vocabulary.set(key, { display, count });
  }
  return vocabulary;
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Similitud de trigramas, la misma medida que `similarity()` de pg_trgm. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  const total = left.size + right.size - shared;
  return total === 0 ? 0 : shared / total;
}

/** Distancia de edición (inserción, borrado, sustitución y transposición de vecinas). */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        table[i][j] = Math.min(table[i][j], table[i - 2][j - 2] + 1);
      }
    }
  }
  return table[a.length][b.length];
}

/**
 * Parecido entre lo tecleado y una palabra del catálogo, de 0 a 1. Manda la
 * distancia de edición («sentadiya» está a dos letras de «sentadilla» y a tres
 * de «sentado»); los trigramas solo desempatan.
 */
function wordCloseness(typed: string, candidate: string): number {
  const distance = editDistance(typed, candidate);
  const byEdits = 1 - distance / Math.max(typed.length, candidate.length);
  return byEdits * 0.8 + trigramSimilarity(typed, candidate) * 0.2;
}

/** Por debajo de esto dos palabras no se parecen lo bastante para proponer una. */
const SUGGESTION_MIN_CLOSENESS = 0.62;

function existsInVocabulary(word: string, vocabulary: Vocabulary): boolean {
  if (vocabulary.has(word)) return true;
  const base = singular(word);
  if (base && vocabulary.has(base)) return true;
  // Mientras se teclea: «sentad» ya es el principio de una palabra del catálogo.
  for (const key of vocabulary.keys()) if (key.startsWith(word)) return true;
  return false;
}

function closestWord(word: string, vocabulary: Vocabulary): string | null {
  let best: { display: string; score: number; count: number } | null = null;
  for (const [key, entry] of vocabulary) {
    if (Math.abs(key.length - word.length) > 2) continue;
    // Una palabra que solo aparece una vez suele ser un nombre propio o una rareza.
    if (entry.count < 2) continue;
    const score = wordCloseness(word, key);
    if (score < SUGGESTION_MIN_CLOSENESS) continue;
    if (!best || score > best.score || (score === best.score && entry.count > best.count)) {
      best = { display: entry.display, score, count: entry.count };
    }
  }
  return best?.display ?? null;
}

/**
 * Texto corregido para «¿Quisiste decir…?», o `null` si la consulta no lo
 * necesita. Solo se corrigen las palabras que no existen en el catálogo ni en
 * los sinónimos y que tienen una palabra parecida clara; el resto se deja como
 * se tecleó.
 */
export function suggestCorrection(plan: SearchPlan, vocabulary: Vocabulary): string | null {
  if (vocabulary.size === 0) return null;
  let corrected = false;
  const words = plan.normalized.split(' ').filter(Boolean);
  const known = new Set(
    plan.groups.filter((group) => group.known).flatMap((group) => group.typed.split(' ')),
  );
  const result = words.map((word) => {
    if (STOPWORDS.has(word) || known.has(word) || word.length < 4) return word;
    if (existsInVocabulary(word, vocabulary)) return word;
    const closest = closestWord(word, vocabulary);
    if (!closest || normalizeSearchText(closest) === word) return word;
    corrected = true;
    return closest;
  });
  return corrected ? result.join(' ') : null;
}
