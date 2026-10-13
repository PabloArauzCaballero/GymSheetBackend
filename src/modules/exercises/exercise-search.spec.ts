import {
  buildVocabulary,
  editDistance,
  expandFilterTerm,
  normalizeSearchText,
  planSearch,
  significantWords,
  suggestCorrection,
} from './exercise-search';
import { EXERCISE_SYNONYMS } from './exercise-search.synonyms';

describe('normalizeSearchText', () => {
  it('quita acentos, mayúsculas y signos, como `repp_normalize` en la base', () => {
    expect(normalizeSearchText('  Jalón al PECHO (agarre-ancho) ')).toBe('jalon al pecho agarre ancho');
    expect(normalizeSearchText('Pull-up 45°')).toBe('pull up 45');
    expect(normalizeSearchText('ñandú')).toBe('nandu');
    expect(normalizeSearchText('¿¡!?')).toBe('');
  });
});

describe('planSearch', () => {
  it('descarta las palabras vacías y deja el resto como grupos', () => {
    const plan = planSearch('Remo con la barra');
    expect(plan.normalized).toBe('remo con la barra');
    expect(plan.groups.map((group) => group.typed)).toEqual(['remo', 'barra']);
  });

  it('reconoce la frase más larga antes que sus palabras sueltas', () => {
    const plan = planSearch('peso muerto rumano');
    expect(plan.groups.map((group) => group.typed)).toEqual(['peso muerto', 'rumano']);
    expect(plan.groups[0].alternatives).toEqual(['peso muerto', 'deadlift']);
    expect(plan.groups[0].known).toBe(true);
    expect(plan.groups[1]).toEqual({ typed: 'rumano', alternatives: ['rumano'], known: false });
  });

  it('entiende los nombres de la calle en las dos lenguas', () => {
    const alternatives = (query: string) => planSearch(query).groups.flatMap((group) => group.alternatives);
    expect(alternatives('press banca')).toEqual(expect.arrayContaining(['press de banca', 'bench press']));
    expect(alternatives('pull up')).toEqual(expect.arrayContaining(['dominada', 'pull up']));
    expect(alternatives('lagartijas')).toEqual(expect.arrayContaining(['push up', 'flexiones de brazos']));
    expect(alternatives('squat')).toEqual(expect.arrayContaining(['sentadilla']));
    expect(alternatives('mancuernas')).toEqual(expect.arrayContaining(['dumbbell']));
  });

  it('trata el plural regular como el singular', () => {
    expect(planSearch('dominadas').groups[0].known).toBe(true);
    expect(planSearch('zancadas').groups[0].alternatives).toEqual(expect.arrayContaining(['lunge']));
  });

  it('una consulta solo con palabras vacías no produce grupos', () => {
    expect(planSearch('de la con').groups).toEqual([]);
    expect(planSearch('   ').groups).toEqual([]);
  });

  it('acota el número de grupos de una consulta larguísima', () => {
    const plan = planSearch(Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(' '));
    expect(plan.groups.length).toBeLessThanOrEqual(8);
  });
});

describe('significantWords / expandFilterTerm', () => {
  it('quita las palabras vacías salvo que no quede nada', () => {
    expect(significantWords('press de banca')).toEqual(['press', 'banca']);
    expect(significantWords('de la')).toEqual(['de', 'la']);
  });

  it('amplía un filtro de equipo o músculo a sus equivalentes', () => {
    expect(expandFilterTerm('Mancuernas')).toEqual(expect.arrayContaining(['mancuernas', 'dumbbell']));
    expect(expandFilterTerm('pecho')).toEqual(expect.arrayContaining(['chest', 'pectoral']));
    expect(expandFilterTerm('glúteos')).toEqual(expect.arrayContaining(['glutes']));
    expect(expandFilterTerm('rodillo de espuma')).toEqual(['rodillo de espuma']);
    expect(expandFilterTerm('  ')).toEqual([]);
  });
});

describe('diccionario de sinónimos', () => {
  it('no repite un término en dos grupos (sería ambiguo cuál gana)', () => {
    const seen = new Map<string, number>();
    EXERCISE_SYNONYMS.forEach((group, index) => {
      for (const term of group.terms) {
        const key = normalizeSearchText(term);
        expect([key, seen.get(key)]).toEqual([key, undefined]);
        seen.set(key, index);
      }
    });
  });

  it('todo término y destino ya está normalizado', () => {
    for (const group of EXERCISE_SYNONYMS) {
      for (const text of [...group.terms, ...group.targets]) {
        expect(normalizeSearchText(text)).toBe(text);
      }
      expect(group.targets.length).toBeGreaterThan(0);
    }
  });
});

describe('suggestCorrection («¿Quisiste decir…?»)', () => {
  const vocabulary = buildVocabulary([
    'Sentadilla con barra barbell squat',
    'Sentadilla búlgara split squat',
    'Sentado en banco seated',
    'Sentado remo seated row',
    'Curl de bíceps con mancuernas dumbbell biceps curl',
    'Curl de bíceps en polea cable biceps curl',
    'Elevaciones laterales con mancuernas lateral raise',
    'Elevaciones laterales en polea cable lateral raise',
    'Press de banca con mancuernas dumbbell bench press',
  ]);

  it('distancia de edición: cuenta la transposición como un solo cambio', () => {
    expect(editDistance('sentadilla', 'sentadilla')).toBe(0);
    expect(editDistance('sentadiya', 'sentadilla')).toBe(2);
    expect(editDistance('crul', 'curl')).toBe(1);
  });

  it('propone la palabra del catálogo más cercana, con su acento', () => {
    expect(suggestCorrection(planSearch('sentadiya'), vocabulary)).toBe('sentadilla');
    expect(suggestCorrection(planSearch('biseps'), vocabulary)).toBe('bíceps');
    expect(suggestCorrection(planSearch('mancuernaz'), vocabulary)).toBe('mancuernas');
  });

  it('corrige solo la palabra mal escrita y conserva el resto', () => {
    expect(suggestCorrection(planSearch('elevasiones laterales con mancuernas'), vocabulary)).toBe(
      'elevaciones laterales con mancuernas',
    );
  });

  it('no propone nada si todo existe, es un sinónimo conocido o se está tecleando', () => {
    expect(suggestCorrection(planSearch('sentadilla con barra'), vocabulary)).toBeNull();
    expect(suggestCorrection(planSearch('pull up'), vocabulary)).toBeNull();
    expect(suggestCorrection(planSearch('lagartijas'), vocabulary)).toBeNull();
    expect(suggestCorrection(planSearch('sentad'), vocabulary)).toBeNull();
    expect(suggestCorrection(planSearch('mancuerna'), vocabulary)).toBeNull();
  });

  it('no inventa una corrección para algo que no se parece a nada', () => {
    expect(suggestCorrection(planSearch('xyzqw'), vocabulary)).toBeNull();
    expect(suggestCorrection(planSearch('sentadiya'), new Map())).toBeNull();
  });
});
