/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return --
   supertest tipa las respuestas como `any`. */
import request from 'supertest';
import { RoutinesShowcaseSeeder } from '../src/database/seeders/showcase/routines-showcase.seed';
import { bootE2eApp, E2eApp } from './support/e2e-app';

/** §C7 · GET /routines/recommended sobre las 20 plantillas sembradas por el seeder real. */
describe('Routines recommended (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    // El seeder es idempotente: en una base ya sembrada no crea nada.
    await new RoutinesShowcaseSeeder(e2e.app, 'e2e-strong-password').run();
  }, 180000);

  afterAll(async () => {
    await e2e.app?.close();
  });

  async function personWith(label: string, onboarding: {
    goal: string;
    level: string;
    frequency: number;
    location: string;
    equipment: string[];
  }) {
    const person = await e2e.register(label);
    const api = e2e.as(person.token);
    await api.put('/me/onboarding/goals').send({ primaryGoal: onboarding.goal }).expect(200);
    await api
      .put('/me/onboarding/preferences')
      .send({
        experienceLevel: onboarding.level,
        weeklyFrequency: onboarding.frequency,
        trainingLocation: onboarding.location,
        trainingPreferences: [],
        consentHealth: true,
        consentData: true,
      })
      .expect(200);
    await api.put('/me/onboarding/equipment').send({ availableEquipment: onboarding.equipment }).expect(200);
    return person;
  }

  const recommended = async (token: string, query = '') =>
    (await e2e.as(token).get(`/routines/recommended${query}`).expect(200)).body.data as Array<{
      rutina: { id: string; nombre: string; esOficial: boolean; autor: { nombre: string }; diasPorSemana: number; valoracion: { promedio: number | null } };
      motivo: string;
      plantilla: { plantilla: string; nivel: string; lugar: string[] };
    }>;

  it('401 sin token', async () => {
    await request(e2e.http).get(e2e.url('/routines/recommended')).expect(401);
  });

  it('400 con un límite fuera de rango', async () => {
    const p = await e2e.register('rec-limit');
    await e2e.as(p.token).get('/routines/recommended?limit=0').expect(400);
    await e2e.as(p.token).get('/routines/recommended?limit=11').expect(400);
  });

  it('sin onboarding: «Salud total 3 días», oficial de REPP, con motivo', async () => {
    const p = await e2e.register('rec-nada');
    const items = await recommended(p.token);
    expect(items).toHaveLength(1);
    expect(items[0].plantilla.plantilla).toBe('repp-salud-total-3-dias');
    expect(items[0].rutina.esOficial).toBe(true);
    expect(items[0].rutina.autor.nombre).toBe('Equipo REPP');
    expect(items[0].motivo).toBe('Para tu salud · 3 días · gimnasio');
  });

  it('tres perfiles distintos reciben recomendaciones distintas y coherentes (aceptación §C7)', async () => {
    const hyper = await personWith('rec-hiper', { goal: 'GAIN_MUSCLE', level: 'INTERMEDIATE', frequency: 4, location: 'GYM', equipment: [] });
    const fat = await personWith('rec-grasa', { goal: 'LOSE_FAT', level: 'BEGINNER', frequency: 3, location: 'HOME', equipment: ['Bandas', 'Peso corporal'] });
    const strength = await personWith('rec-fuerza', { goal: 'IMPROVE_STRENGTH', level: 'BEGINNER', frequency: 3, location: 'GYM', equipment: [] });

    const h = await recommended(hyper.token);
    expect(h).toHaveLength(3);
    expect(h[0].rutina.nombre).toBe('Torso-Pierna 4 días');
    expect(h[0].motivo).toBe('Para hipertrofia · 4 días · gimnasio');
    expect(h.every((r) => r.rutina.diasPorSemana <= 4)).toBe(true);

    const f = await recommended(fat.token);
    expect(f[0].plantilla.plantilla).toBe('repp-circuito-casa-3-dias');
    expect(f[0].motivo).toBe('Para perder grasa · 3 días · en casa');
    expect(f.every((r) => r.plantilla.lugar.includes('HOME'))).toBe(true);

    const s = await recommended(strength.token);
    expect(s[0].plantilla.plantilla).toBe('repp-fuerza-base-3-dias');
    expect(s[0].motivo).toBe('Para fuerza · 3 días · gimnasio');
    expect(s.every((r) => ['PRINCIPIANTE', 'TODOS'].includes(r.plantilla.nivel))).toBe(true);

    expect(new Set([h[0].rutina.id, f[0].rutina.id, s[0].rutina.id]).size).toBe(3);
  });

  it('el límite se respeta y la ruta no choca con /routines/:id', async () => {
    const p = await personWith('rec-limit1', { goal: 'GAIN_MUSCLE', level: 'ADVANCED', frequency: 6, location: 'GYM', equipment: [] });
    const items = await recommended(p.token, '?limit=1');
    expect(items).toHaveLength(1);
    expect(items[0].plantilla.plantilla).toBe('repp-empuje-tiron-pierna-6-dias');
  });

  it('una plantilla oculta por moderación deja de recomendarse', async () => {
    const p = await personWith('rec-oculta', { goal: 'IMPROVE_STRENGTH', level: 'BEGINNER', frequency: 3, location: 'GYM', equipment: [] });
    const first = (await recommended(p.token))[0];
    await e2e.sql(`UPDATE training.routines SET estado_moderacion = 'OCULTA_MODERACION' WHERE id = :id`, { id: first.rutina.id });
    try {
      const again = await recommended(p.token);
      expect(again.map((r) => r.rutina.id)).not.toContain(first.rutina.id);
    } finally {
      await e2e.sql(`UPDATE training.routines SET estado_moderacion = 'VISIBLE' WHERE id = :id`, { id: first.rutina.id });
    }
  });
});
