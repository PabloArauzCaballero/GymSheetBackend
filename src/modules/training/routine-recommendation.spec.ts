import { FitnessGoal, TrainingGoal } from '../../common/enums/domain.enums';
import { RECOMMENDED_TEMPLATES } from '../../database/seeders/showcase/recommended-routines.data';
import {
  clampDays,
  normalizeEquipment,
  RecommendationCandidate,
  RecommendationProfile,
  recommendRoutines,
} from './routine-recommendation';

/** Las 20 plantillas reales, como las vería el servicio tras sembrarlas. */
const catalog: RecommendationCandidate[] = RECOMMENDED_TEMPLATES.map((t) => ({
  id: `id-${t.numero}`,
  plantilla: t.plantilla,
  objetivo: t.objetivo,
  subobjetivo: t.subobjetivo,
  nivel: t.nivel,
  lugar: [...t.lugar],
  equipo: [...t.equipo],
  dias: t.dias.length,
  valoracion: null,
  copias: 0,
  soloSiObjetivo: t.soloSiObjetivo,
}));

const profile = (p: Partial<RecommendationProfile>): RecommendationProfile => ({
  primaryGoal: null,
  profileGoal: null,
  level: null,
  weeklyFrequency: null,
  location: null,
  equipment: [],
  ...p,
});

const keys = (p: Partial<RecommendationProfile>, list = catalog) => recommendRoutines(profile(p), list).map((r) => r.candidate.plantilla);
const motivos = (p: Partial<RecommendationProfile>) => recommendRoutines(profile(p), catalog).map((r) => r.motivo);

describe('recommendRoutines (regla §C7)', () => {
  it('sin datos devuelve solo «Salud total 3 días»', () => {
    expect(keys({})).toEqual(['repp-salud-total-3-dias']);
    expect(motivos({})).toEqual(['Para tu salud · 3 días · gimnasio']);
  });

  it('hipertrofia · 4 días · gimnasio · intermedio: Torso-Pierna primero, nunca más de 4 días', () => {
    const got = keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'INTERMEDIATE', weeklyFrequency: 4, location: 'GYM' });
    expect(got).toEqual(['repp-torso-pierna-4-dias', 'repp-cuerpo-completo-3-dias', 'repp-hipertrofia-expres-2-dias']);
    expect(motivos({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'INTERMEDIATE', weeklyFrequency: 4, location: 'GYM' })[0]).toBe(
      'Para hipertrofia · 4 días · gimnasio',
    );
  });

  it('hipertrofia avanzado 6 días: PPL exacto', () => {
    expect(keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'ADVANCED', weeklyFrequency: 6, location: 'GYM' })[0]).toBe(
      'repp-empuje-tiron-pierna-6-dias',
    );
  });

  it('frecuencia 7 se recorta a 6; 1 sube a 2', () => {
    expect(clampDays(7)).toBe(6);
    expect(clampDays(1)).toBe(2);
    expect(clampDays(null)).toBe(3);
    expect(keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'ADVANCED', weeklyFrequency: 7, location: 'GYM' })[0]).toBe(
      'repp-empuje-tiron-pierna-6-dias',
    );
    expect(keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'BEGINNER', weeklyFrequency: 1, location: 'GYM' })[0]).toBe(
      'repp-hipertrofia-expres-2-dias',
    );
  });

  it('avanzado 5 días sin plantilla exacta de hipertrofia: la de menos días más cercana (4), nunca la de 6', () => {
    const got = keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'ADVANCED', weeklyFrequency: 5, location: 'GYM' });
    expect(got[0]).toBe('repp-torso-pierna-4-dias');
    expect(got).not.toContain('repp-empuje-tiron-pierna-6-dias');
  });

  it('principiante nunca recibe plantillas de intermedio ni avanzado', () => {
    const got = keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'BEGINNER', weeklyFrequency: 6, location: 'GYM' });
    expect(got).toEqual(['repp-cuerpo-completo-3-dias', 'repp-hipertrofia-expres-2-dias', 'repp-salud-total-3-dias']);
  });

  it('fuerza · 3 días · principiante: 5×5 adaptado primero', () => {
    const got = keys({ primaryGoal: FitnessGoal.IMPROVE_STRENGTH, level: 'BEGINNER', weeklyFrequency: 3, location: 'GYM' });
    expect(got).toEqual(['repp-fuerza-base-3-dias', 'repp-fuerza-2-dias', 'repp-salud-total-3-dias']);
    expect(motivos({ primaryGoal: FitnessGoal.IMPROVE_STRENGTH, level: 'BEGINNER', weeklyFrequency: 3, location: 'GYM' })[0]).toBe(
      'Para fuerza · 3 días · gimnasio',
    );
  });

  it('fuerza intermedio 4 días: ondulante; avanzado 5 días: powerbuilding', () => {
    expect(keys({ primaryGoal: FitnessGoal.IMPROVE_STRENGTH, level: 'INTERMEDIATE', weeklyFrequency: 4, location: 'GYM' })[0]).toBe(
      'repp-fuerza-torso-pierna-ondulante',
    );
    expect(keys({ primaryGoal: FitnessGoal.IMPROVE_STRENGTH, level: 'ADVANCED', weeklyFrequency: 5, location: 'GYM' })[0]).toBe(
      'repp-powerbuilding-5-dias',
    );
  });

  it('pérdida de grasa · 3 días · en casa: circuito en casa, nada de gimnasio', () => {
    const p = { primaryGoal: FitnessGoal.LOSE_FAT, level: 'BEGINNER' as const, weeklyFrequency: 3, location: 'HOME' as const };
    // Primero las del objetivo (3 días, luego 2); después se completa con salud general en casa.
    expect(keys(p)).toEqual(['repp-circuito-casa-3-dias', 'repp-minimo-eficaz-2-dias', 'repp-casa-bandas-3-dias']);
    expect(motivos(p)[0]).toBe('Para perder grasa · 3 días · en casa');
  });

  it('en casa con solo bandas: descarta las de mancuernas', () => {
    const got = keys({ primaryGoal: FitnessGoal.LOSE_FAT, level: 'BEGINNER', weeklyFrequency: 3, location: 'HOME', equipment: ['Bandas', 'Peso corporal'] });
    expect(got).toEqual(['repp-circuito-casa-3-dias', 'repp-casa-bandas-3-dias']);
  });

  it('al aire libre se trata como casa', () => {
    expect(keys({ primaryGoal: FitnessGoal.IMPROVE_ENDURANCE, level: 'BEGINNER', weeklyFrequency: 3, location: 'OUTDOORS' })[0]).toBe(
      'repp-base-aerobica-4-semanas',
    );
  });

  it('casa sin equipo declarado no filtra por equipo («no lo dijo» no es «no tiene»)', () => {
    expect(keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'BEGINNER', weeklyFrequency: 2, location: 'HOME' })[0]).toBe(
      'repp-hipertrofia-expres-2-dias',
    );
  });

  it('MIXED acepta gimnasio y casa', () => {
    const got = keys({ primaryGoal: FitnessGoal.LOSE_FAT, level: 'INTERMEDIATE', weeklyFrequency: 4, location: 'MIXED', equipment: ['Mancuernas'] });
    expect(got[0]).toBe('repp-quema-4-dias');
    expect(got).toContain('repp-recomposicion-3-dias');
  });

  it('pérdida de grasa intermedio 4 días en gimnasio', () => {
    expect(motivos({ primaryGoal: FitnessGoal.LOSE_FAT, level: 'INTERMEDIATE', weeklyFrequency: 4, location: 'GYM' })[0]).toBe(
      'Para perder grasa · 4 días · gimnasio',
    );
  });

  it('resistencia intermedio 3 días: híbrido; 2 días: corredores', () => {
    expect(keys({ primaryGoal: FitnessGoal.IMPROVE_ENDURANCE, level: 'INTERMEDIATE', weeklyFrequency: 3, location: 'GYM' })[0]).toBe(
      'repp-hibrido-3-dias',
    );
    expect(keys({ primaryGoal: FitnessGoal.IMPROVE_ENDURANCE, level: 'INTERMEDIATE', weeklyFrequency: 2, location: 'GYM' })[0]).toBe(
      'repp-fuerza-corredores-2-dias',
    );
  });

  it('deporte (SPORT_PERFORMANCE) prioriza la plantilla con subobjetivo DEPORTE', () => {
    expect(keys({ primaryGoal: FitnessGoal.SPORT_PERFORMANCE, level: 'INTERMEDIATE', weeklyFrequency: 2, location: 'GYM' })[0]).toBe(
      'repp-atleta-complementario-2-dias',
    );
  });

  it('mantener (MAINTAIN_FITNESS) va a salud general', () => {
    expect(keys({ primaryGoal: FitnessGoal.MAINTAIN_FITNESS, level: 'BEGINNER', weeklyFrequency: 3, location: 'GYM' })[0]).toBe(
      'repp-salud-total-3-dias',
    );
  });

  it('salud general 2 días principiante: primeros pasos en máquinas', () => {
    expect(keys({ primaryGoal: FitnessGoal.GENERAL_HEALTH, level: 'BEGINNER', weeklyFrequency: 2, location: 'GYM' })[0]).toBe(
      'repp-primeros-pasos-maquinas',
    );
  });

  it('«Vuelta suave» solo para rehabilitación (por el objetivo del perfil) y sin completar con otras', () => {
    expect(keys({ profileGoal: TrainingGoal.REHABILITATION, weeklyFrequency: 3, location: 'HOME' })).toEqual(['repp-vuelta-suave']);
    for (const goal of Object.values(FitnessGoal)) {
      expect(keys({ primaryGoal: goal, level: 'ADVANCED', weeklyFrequency: 3, location: 'MIXED' })).not.toContain('repp-vuelta-suave');
    }
  });

  it('desempate: valoración y después copias', () => {
    const rated = catalog.map((c) =>
      c.plantilla === 'repp-fuerza-2-dias' ? { ...c, valoracion: 4.6 } : c.plantilla === 'repp-hipertrofia-expres-2-dias' ? { ...c, copias: 9 } : c,
    );
    const twoDays = keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'BEGINNER', weeklyFrequency: 2, location: 'GYM' }, rated);
    expect(twoDays[0]).toBe('repp-hipertrofia-expres-2-dias');
    const tie = [
      { ...catalog[0], plantilla: 'a', valoracion: 4.2, copias: 1 },
      { ...catalog[0], plantilla: 'b', valoracion: 4.8, copias: 0 },
      { ...catalog[0], plantilla: 'c', valoracion: 4.8, copias: 5 },
    ];
    expect(keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'BEGINNER', weeklyFrequency: 3, location: 'GYM' }, tie)).toEqual(['c', 'b', 'a']);
  });

  it('si nada encaja, «Salud total 3 días»', () => {
    const onlyAdvanced = catalog.filter((c) => c.nivel === 'AVANZADO' || c.plantilla === 'repp-salud-total-3-dias');
    expect(keys({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'BEGINNER', weeklyFrequency: 2, location: 'HOME' }, onlyAdvanced)).toEqual([
      'repp-salud-total-3-dias',
    ]);
  });

  it('respeta el límite', () => {
    expect(recommendRoutines(profile({ primaryGoal: FitnessGoal.GAIN_MUSCLE, level: 'ADVANCED', weeklyFrequency: 6, location: 'GYM' }), catalog, 1)).toHaveLength(1);
  });

  it('normaliza el equipo del onboarding (etiquetas con tildes y códigos)', () => {
    expect([...normalizeEquipment(['Máquinas', 'Barra y discos', 'PESO_CORPORAL', ' bandas '])]).toEqual([
      'MAQUINAS',
      'BARRA',
      'PESO_CORPORAL',
      'BANDAS',
    ]);
  });
});
