/**
 * Puntos por completar el perfil (`docs/progression/la-senda.md` §5.1).
 *
 * Cada dato del perfil vale unos puntos que se ganan **una vez**: el libro
 * `progression.profile_completion_awards` es de solo inserción, igual que los
 * bonos de modo. Borrar la foto después no quita los puntos —los puntos son
 * historia— y volver a subirla no los duplica.
 *
 * Este módulo es puro: el catálogo, qué cuenta como hecho y la vista. Lo que
 * toca la base vive en `profile-completion.repository.ts`.
 */
import { stripInvisibleCharacters } from "../../common/text/invisible-characters";

/** Lo que la base sabe del perfil de una persona, en una sola lectura. */
export interface ProfileFacts {
  hasBodyProfile: boolean;
  hasBirthDate: boolean;
  photoCount: number;
  hasBio: boolean;
  hasGender: boolean;
  hasExperienceLevel: boolean;
  interestCount: number;
}

export type ProfileItemCode =
  | "DATOS"
  | "FOTO"
  | "FOTOS_3"
  | "BIO"
  | "NACIMIENTO"
  | "NIVEL"
  | "INTERESES"
  | "GENERO";

export interface ProfileItemDefinition {
  code: ProfileItemCode;
  /** Lo que falta, dicho como acción: verbo primero. */
  label: string;
  /** Por qué importa, en una frase corta. */
  hint: string;
  points: number;
  done: (facts: ProfileFacts) => boolean;
}

/**
 * El catálogo. Calibración: el perfil completo (250) vale menos que dos
 * sesiones corrientes (~150 cada una): premia completarlo sin que sea un atajo
 * para subir de rango. Lo que más vale es lo que más cambia la carta que ven
 * los demás (las fotos, la bio y los datos).
 */
export const PROFILE_COMPLETION_ITEMS: readonly ProfileItemDefinition[] = [
  {
    code: "FOTO",
    label: "Sube tu primera foto",
    hint: "Una cara se reconoce en el gimnasio.",
    points: 50,
    done: (facts) => facts.photoCount >= 1,
  },
  {
    code: "DATOS",
    label: "Añade peso, estatura y objetivo",
    hint: "Ajustan tus cargas y tus rutinas.",
    points: 50,
    done: (facts) => facts.hasBodyProfile,
  },
  {
    code: "BIO",
    label: "Escribe unas líneas sobre ti",
    hint: "Da tema para empezar a hablar.",
    points: 40,
    done: (facts) => facts.hasBio,
  },
  {
    code: "FOTOS_3",
    label: "Llega a tres fotos",
    hint: "Más fotos, más contexto.",
    points: 30,
    done: (facts) => facts.photoCount >= 3,
  },
  {
    code: "NIVEL",
    label: "Elige tu nivel",
    hint: "Te junta con gente de tu ritmo.",
    points: 20,
    done: (facts) => facts.hasExperienceLevel,
  },
  {
    code: "INTERESES",
    label: "Marca qué te gusta entrenar",
    hint: "Fuerza, cardio, movilidad…",
    points: 20,
    done: (facts) => facts.interestCount >= 1,
  },
  {
    code: "NACIMIENTO",
    label: "Añade tu fecha de nacimiento",
    hint: "Tu edad se mantiene al día sola.",
    points: 20,
    done: (facts) => facts.hasBirthDate,
  },
  {
    code: "GENERO",
    label: "Elige cómo te habla tu senda",
    hint: "«Prefiero no decirlo» también cuenta.",
    points: 20,
    done: (facts) => facts.hasGender,
  },
];

export const PROFILE_COMPLETION_TOTAL_POINTS = PROFILE_COMPLETION_ITEMS.reduce(
  (total, item) => total + item.points,
  0,
);

/** Una fila del libro: lo que se ganó y cuánto valía entonces. */
export interface ProfileAward {
  itemCode: string;
  points: number;
  awardedAt: Date;
}

export interface ProfileCompletionItemView {
  code: ProfileItemCode;
  label: string;
  hint: string;
  points: number;
  /** El dato está ahora en el perfil. */
  done: boolean;
  /** Sus puntos ya están en tu saldo (aunque el dato se haya quitado después). */
  awarded: boolean;
  awardedAt: string | null;
}

export interface ProfileCompletionView {
  items: ProfileCompletionItemView[];
  completed: number;
  total: number;
  /** 0..100, redondeado hacia abajo: un 99 % no se anuncia como completo. */
  percent: number;
  pointsEarned: number;
  /** Lo que todavía se puede ganar completando lo que falta. */
  pointsAvailable: number;
  pointsTotal: number;
  /** Ganados en esta lectura, para celebrarlos una vez. */
  awardedNow: ProfileItemCode[];
}

/** Los datos que cumplen y todavía no tienen fila en el libro. */
export function pendingAwards(
  facts: ProfileFacts,
  awards: readonly Pick<ProfileAward, "itemCode">[],
): ProfileItemDefinition[] {
  const awarded = new Set(awards.map((award) => award.itemCode));
  return PROFILE_COMPLETION_ITEMS.filter((item) => item.done(facts) && !awarded.has(item.code));
}

/**
 * Una bio cuenta para el premio si dice algo: al menos tres letras o cifras de
 * cualquier alfabeto. Tres emojis, puntos o espacios invisibles no la
 * completan (la bio se guarda igual, solo no paga). Es el único predicado: lo
 * usan el servicio y la migración que reconoce lo ya existente.
 */
export const BIO_MIN_MEANINGFUL_CHARS = 3;

export function hasMeaningfulBio(bio: string | null | undefined): boolean {
  // Hangul fillers are letters for Unicode: strip them before counting.
  const visible = stripInvisibleCharacters(bio ?? "");
  return (visible.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= BIO_MIN_MEANINGFUL_CHARS;
}

/** Suma del libro: lo que valía cada dato al ganarlo, no lo que vale hoy. */
export function profilePointsOf(awards: readonly Pick<ProfileAward, "points">[]): number {
  return awards.reduce((total, award) => total + Math.max(0, award.points), 0);
}

export function buildProfileCompletionView(
  facts: ProfileFacts,
  awards: readonly ProfileAward[],
  awardedNow: readonly ProfileItemCode[] = [],
): ProfileCompletionView {
  const byCode = new Map(awards.map((award) => [award.itemCode, award]));
  const items = PROFILE_COMPLETION_ITEMS.map((item) => {
    const award = byCode.get(item.code);
    return {
      code: item.code,
      label: item.label,
      hint: item.hint,
      points: award?.points ?? item.points,
      done: item.done(facts),
      awarded: Boolean(award),
      awardedAt: award ? award.awardedAt.toISOString() : null,
    };
  });
  const completed = items.filter((item) => item.done).length;
  return {
    items,
    completed,
    total: items.length,
    percent: Math.floor((completed / items.length) * 100),
    pointsEarned: profilePointsOf(awards),
    pointsAvailable: items.filter((item) => !item.awarded).reduce((total, item) => total + item.points, 0),
    pointsTotal: PROFILE_COMPLETION_TOTAL_POINTS,
    awardedNow: [...awardedNow],
  };
}
