import { INestApplicationContext, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  ExerciseDataSource,
  OnboardingStatus,
  RoutineStatus,
  RoutineVisibility,
  UserRole,
  UserStatus,
} from '../../../common/enums/domain.enums';
import { BusinessDateService } from '../../../common/time/business-date.service';
import { AuthenticatedUser } from '../../../common/types/auth-context.types';
import { env } from '../../../config/env';
import { AuthService } from '../../../modules/auth/auth.service';
import { registerSchema } from '../../../modules/auth/auth.schemas';
import { CommunityService } from '../../../modules/community/community.service';
import { ContentCommentModel } from '../../../modules/community/content-comment.model';
import { ExerciseCommunityService } from '../../../modules/exercises/exercise-community.service';
import { ExerciseMediaModel } from '../../../modules/exercises/exercise-media.model';
import { ExerciseModel } from '../../../modules/exercises/exercise.model';
import { ExerciseLibraryRepository } from '../../../modules/exercises/import/exercise-library.repository';
import { MusclesService } from '../../../modules/exercises/muscles/muscles.service';
import { ModerationService } from '../../../modules/moderation/moderation.service';
import { OnboardingModel } from '../../../modules/profiles/onboarding.model';
import { OnboardingService } from '../../../modules/profiles/onboarding.service';
import { addDays, mondayOf } from '../../../modules/programs/engine/program-calendar';
import { ProgramWeekCloseService } from '../../../modules/programs/program-week-close.service';
import { TrainingProgramModel } from '../../../modules/programs/program.models';
import { ProgramsActivationService } from '../../../modules/programs/programs-activation.service';
import { activateStrengthSchema } from '../../../modules/programs/programs.schemas';
import { RoutinePublicationService } from '../../../modules/training/routine-publication.service';
import { RoutineStructureService } from '../../../modules/training/routine-structure.service';
import { weekOverrideSchema } from '../../../modules/training/routine-v2.schemas';
import { RoutineModel } from '../../../modules/training/routine.model';
import { createRoutineSchema } from '../../../modules/training/training.schemas';
import { TrainingService } from '../../../modules/training/training.service';
import { UserModel } from '../../../modules/users/user.model';
import { createWorkoutSetSchema } from '../../../modules/workouts/workouts.schemas';
import { WorkoutsService } from '../../../modules/workouts/workouts.service';
import { EXERCISE_NAMES_ES } from './exercise-names-es.data';
import { RECOMMENDED_TEMPLATES, RecommendedTemplate, TemplateDay } from './recommended-routines.data';
import {
  COMMENTS,
  COMMUNITY_COPIES,
  COMMUNITY_ROUTINES,
  DEMO_USERS,
  DemoProgram,
  DemoUser,
  LIKED_EXERCISES,
  OFFICIAL_AUTHOR_EMAIL,
  OFFICIAL_AUTHOR_NAME,
  PROGRAMS,
  RATINGS,
} from './showcase-community.data';

/**
 * Seeder `routines-showcase` (10_CORRECCIONES §C6/§C7). Siembra los datos de
 * demostración de TEST llamando a los SERVICIOS reales (no INSERT a mano):
 * así las huellas, versiones, agregados de valoración, notificaciones y el
 * libro de recompensas salen exactamente como en producción.
 *
 * Idempotente por claves naturales: email de la persona, `metadata.plantilla`
 * de la oficial, (autor, nombre) de la de comunidad, (autor, origen) de la
 * copia, (autor, destino, texto) del comentario y «ya tiene programa activo».
 * Una segunda pasada no crea nada.
 *
 * Nunca con NODE_ENV=production. Solo se lanza a mano (`yarn db:seed:showcase`),
 * jamás al arrancar.
 */

export type ShowcaseCounters = Record<string, number>;

type Actor = { id: string; role: UserRole; tenantId: string };
type SeededUser = { user: UserModel; actor: Actor };

const logger = new Logger('RoutinesShowcaseSeed');

export function assertShowcaseAllowed(nodeEnv: string): void {
  if (nodeEnv === 'production') {
    throw new Error('El seeder routines-showcase está prohibido con NODE_ENV=production.');
  }
}

export function resolveShowcasePassword(source: NodeJS.ProcessEnv = process.env): string {
  const password = source.SEED_SHOWCASE_PASSWORD ?? source.SEED_MOCK_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Define SEED_SHOWCASE_PASSWORD (o SEED_MOCK_PASSWORD), mínimo 8 caracteres, para las cuentas @demo.repp.test.');
  }
  return password;
}

/** Todos los external_id que usan plantillas y rutinas de comunidad, con su nombre inglés esperado. */
export function referencedExercises(): Map<string, string> {
  const refs = new Map<string, string>();
  const add = (days: readonly TemplateDay[], owner: string) => {
    for (const day of days) {
      for (const e of day.ejercicios) {
        const previous = refs.get(e.id);
        if (previous !== undefined && previous !== e.en) {
          throw new Error(`${owner}: el ejercicio ${e.id} aparece con dos nombres («${previous}» y «${e.en}»).`);
        }
        refs.set(e.id, e.en);
      }
    }
  };
  for (const t of RECOMMENDED_TEMPLATES) add(t.dias, t.plantilla);
  for (const c of COMMUNITY_ROUTINES) add(c.dias, c.key);
  return refs;
}

export class RoutinesShowcaseSeeder {
  private readonly counters: ShowcaseCounters = {};
  private readonly users = new Map<string, SeededUser>();
  private readonly exerciseIds = new Map<string, string>();
  /** clave de comunidad u oficial (`plantilla`) → id de rutina. */
  private readonly routineIds = new Map<string, string>();
  private readonly sequelize: Sequelize;

  constructor(
    private readonly app: INestApplicationContext,
    private readonly password: string,
  ) {
    this.sequelize = app.get(Sequelize, { strict: false });
  }

  private get<T>(token: abstract new (...args: never[]) => T): T {
    return this.app.get(token as never, { strict: false });
  }

  private count(key: string, by = 1): void {
    this.counters[key] = (this.counters[key] ?? 0) + by;
  }

  async run(): Promise<ShowcaseCounters> {
    assertShowcaseAllowed(env.NODE_ENV);
    await this.resolveExercises();
    await this.seedSpanishNames();
    const author = await this.ensureOfficialAuthor();
    for (const template of RECOMMENDED_TEMPLATES) await this.ensureOfficial(author, template);
    for (const demo of DEMO_USERS) await this.ensureDemoUser(demo);
    for (const routine of COMMUNITY_ROUTINES) await this.ensureCommunityRoutine(routine);
    for (const copy of COMMUNITY_COPIES) await this.ensureCopy(copy.user, this.routineId(copy.routine));
    await this.seedRatings();
    await this.seedComments();
    await this.seedLikesAndFavorites();
    for (const program of PROGRAMS) await this.ensureProgram(program);
    return this.counters;
  }

  // ── Catálogo ────────────────────────────────────────────────────────────

  /** Resuelve TODOS los ejercicios por external_id + nombre exacto. Si falta uno, falla. */
  private async resolveExercises(): Promise<void> {
    const refs = referencedExercises();
    for (const [id, names] of Object.entries(EXERCISE_NAMES_ES)) {
      if (refs.has(id) && refs.get(id) !== names.en) throw new Error(`Diccionario y plantillas no coinciden en ${id}.`);
      refs.set(id, names.en);
    }
    const rows = await ExerciseModel.findAll({
      where: { externalId: { [Op.in]: [...refs.keys()] }, dataSource: ExerciseDataSource.EXERCISES_DATASET },
    });
    const byExternal = new Map(rows.map((row) => [row.externalId ?? '', row]));
    const missing = [...refs].filter(([id, en]) => byExternal.get(id)?.name !== en).map(([id, en]) => `${id} «${en}»`);
    if (missing.length > 0) {
      throw new Error(
        `Faltan ${missing.length} ejercicios del catálogo (o cambió su nombre): ${missing.join(', ')}. ` +
          'Siembra antes el catálogo (yarn db:seed:base) o corrige la plantilla.',
      );
    }
    for (const [id, row] of byExternal) this.exerciseIds.set(id, row.id);
    this.count('ejercicios_resueltos', byExternal.size);
  }

  private exerciseId(externalId: string): string {
    const id = this.exerciseIds.get(externalId);
    if (!id) throw new Error(`Ejercicio ${externalId} sin resolver.`);
    return id;
  }

  /** Diccionario revisado de nombres en español (C3.b), con el gancho de la biblioteca. */
  private async seedSpanishNames(): Promise<void> {
    // Mismo repositorio que usa la carga de la biblioteca; sus modelos son los de la app.
    const library = new ExerciseLibraryRepository(ExerciseModel, ExerciseMediaModel);
    const rows = await ExerciseModel.findAll({ where: { id: { [Op.in]: [...this.exerciseIds.values()] } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const [externalId, names] of Object.entries(EXERCISE_NAMES_ES)) {
      const exercise = byId.get(this.exerciseId(externalId));
      if (exercise && (await library.setSpanishName(exercise, names.es))) this.count('nombres_es_escritos');
    }
  }

  // ── Personas ────────────────────────────────────────────────────────────

  private async ensureUser(email: string, fullName: string, gender: 'MALE' | 'FEMALE' | null, password: string): Promise<UserModel> {
    let user = await UserModel.findOne({ where: { email } });
    if (!user) {
      await this.get(AuthService).register(
        registerSchema.parse({ email, password, nombreCompleto: fullName, acceptedTerms: true, ...(gender ? { genero: gender } : {}) }),
      );
      user = await UserModel.findOne({ where: { email }, rejectOnEmpty: true });
      this.count('usuarios_creados');
    }
    if (user.status !== UserStatus.ACTIVE) await user.update({ status: UserStatus.ACTIVE });
    return user;
  }

  private actorOf(user: UserModel): Actor {
    return { id: user.id, role: user.role, tenantId: user.tenantId ?? env.DEFAULT_TENANT_ID ?? '' };
  }

  private async ensureOfficialAuthor(): Promise<Actor> {
    // Cuenta de autoría, no de acceso: contraseña aleatoria que nadie conoce.
    const user = await this.ensureUser(OFFICIAL_AUTHOR_EMAIL, OFFICIAL_AUTHOR_NAME, null, randomBytes(24).toString('base64url'));
    return this.actorOf(user);
  }

  private async ensureDemoUser(demo: DemoUser): Promise<void> {
    const user = await this.ensureUser(demo.email, demo.fullName, demo.gender, this.password);
    if (demo.coach && user.role !== UserRole.COACH) await user.update({ role: UserRole.COACH });
    this.users.set(demo.key, { user, actor: this.actorOf(user) });
    await this.ensureOnboarding(user.id, demo);
  }

  private async ensureOnboarding(userId: string, demo: DemoUser): Promise<void> {
    const existing = await OnboardingModel.findByPk(userId);
    if (existing?.status === OnboardingStatus.COMPLETED) return;
    const onboarding = this.get(OnboardingService);
    await onboarding.saveGoals(userId, { primaryGoal: demo.goal });
    await onboarding.saveProfile(userId, {
      weight: demo.weightKg,
      weightUnit: 'KG',
      height: demo.heightCm,
      heightUnit: 'CM',
      measuredOn: this.realToday(),
      idempotencyKey: `showcase-onboarding:${demo.key}`,
    });
    await onboarding.savePreferences(userId, {
      experienceLevel: demo.level,
      weeklyFrequency: demo.frequency,
      trainingLocation: demo.location,
      trainingPreferences: demo.preferences,
      physicalConsiderations: null,
      consentHealth: true,
      consentData: true,
    });
    await onboarding.saveEquipment(userId, { availableEquipment: demo.equipment });
    await onboarding.complete(userId);
    this.count('onboardings_completados');
  }

  private seeded(key: string): SeededUser {
    const found = this.users.get(key);
    if (!found) throw new Error(`Persona demo desconocida: ${key}`);
    return found;
  }

  // ── Rutinas ─────────────────────────────────────────────────────────────

  private routineId(key: string): string {
    const id = this.routineIds.get(key);
    if (!id) throw new Error(`Rutina sin sembrar: ${key}`);
    return id;
  }

  private daysInput(days: readonly TemplateDay[]) {
    return days.map((day) => ({
      diaSemana: day.diaSemana,
      nombre: day.nombre,
      ejercicios: day.ejercicios.map((e) => ({
        ejercicioId: this.exerciseId(e.id),
        seriesObjetivo: e.series,
        repsMin: e.reps?.[0] ?? null,
        repsMax: e.reps?.[1] ?? null,
        pesoObjetivoKg: null,
        rirObjetivo: e.rir,
        descansoSeg: e.descanso,
        nota: e.nota,
        grupo: e.grupo,
        descansoEntreSeg: e.entre,
        duracionSeg: e.seg,
      })),
    }));
  }

  private templateMetadata(t: RecommendedTemplate): Record<string, unknown> {
    return {
      plantilla: t.plantilla,
      numero: t.numero,
      nivel: t.nivel,
      lugar: [...t.lugar],
      equipo: [...t.equipo],
      minSesion: t.minSesion,
      subobjetivo: t.subobjetivo,
      modoSugerido: t.modo,
      planCardio: t.planCardio,
      aviso: t.aviso,
      soloSiObjetivo: t.soloSiObjetivo,
      revisionHumana: 'PENDIENTE',
    };
  }

  private async ensureOfficial(author: Actor, t: RecommendedTemplate): Promise<void> {
    let routine = await RoutineModel.findOne({
      where: { createdByUserId: author.id, status: RoutineStatus.ACTIVE, metadata: { plantilla: t.plantilla } },
    });
    if (!routine) {
      const input = createRoutineSchema.parse({
        nombre: t.nombre,
        descripcion: t.aviso ? `${t.descripcion}\n\n⚠️ ${t.aviso}` : t.descripcion,
        objetivo: t.objetivo,
        duracionSemanas: t.duracionSemanas,
        progresion: { activa: true, ...t.progresion },
        dias: this.daysInput(t.dias),
      });
      const created = await this.get(TrainingService).createRoutine(author, input);
      routine = await RoutineModel.findByPk(created.id, { rejectOnEmpty: true });
      await routine.update({ metadata: this.templateMetadata(t) });
      for (const week of t.semanas) {
        await this.get(RoutineStructureService).setWeekOverride(
          author,
          routine.id,
          week.semana,
          weekOverrideSchema.parse({ esDescarga: false, factorVolumen: week.factorVolumen, nota: week.nota }),
        );
      }
      this.count('oficiales_creadas');
    }
    if (routine.visibility !== RoutineVisibility.PUBLIC) {
      await this.get(RoutinePublicationService).publish(author, routine.id);
      await routine.reload();
    }
    // `es_oficial` lo gestiona REPP (setOfficial exige SYSTEM_ADMIN); la cuenta
    // de autoría no lo es, así que se marca aquí, tras publicarla por el servicio.
    if (!routine.isOfficial) await routine.update({ isOfficial: true });
    this.routineIds.set(t.plantilla, routine.id);
  }

  private async ensureCommunityRoutine(c: (typeof COMMUNITY_ROUTINES)[number]): Promise<void> {
    const { actor } = this.seeded(c.author);
    let routine = await RoutineModel.findOne({
      where: { createdByUserId: actor.id, name: c.nombre, status: RoutineStatus.ACTIVE },
    });
    if (!routine) {
      const created = await this.get(TrainingService).createRoutine(
        actor,
        createRoutineSchema.parse({
          nombre: c.nombre,
          descripcion: c.descripcion,
          objetivo: c.objetivo,
          duracionSemanas: c.duracionSemanas,
          progresion: { activa: true, descargaCada: 4, volumenDescarga: 0.6, cargaDescarga: 0.9 },
          dias: this.daysInput(c.dias),
        }),
      );
      routine = await RoutineModel.findByPk(created.id, { rejectOnEmpty: true });
      this.count('comunidad_creadas');
    }
    if (routine.visibility !== RoutineVisibility.PUBLIC) {
      await this.get(RoutinePublicationService).publish({ ...actor }, routine.id);
      this.count('comunidad_publicadas');
    }
    this.routineIds.set(c.key, routine.id);
  }

  /** La copia «· v1» de la persona (con atribución); idempotente por (autor, origen). */
  private async ensureCopy(userKey: string, sourceId: string): Promise<string> {
    const { actor } = this.seeded(userKey);
    const existing = await RoutineModel.findOne({
      where: { createdByUserId: actor.id, basedOnRoutineId: sourceId, status: RoutineStatus.ACTIVE },
      order: [['created_at', 'ASC']],
    });
    if (existing) return existing.id;
    const copy = await this.get(RoutinePublicationService).copy(actor, sourceId);
    this.count('copias_creadas');
    return copy.id;
  }

  // ── Comunidad ───────────────────────────────────────────────────────────

  private async seedRatings(): Promise<void> {
    const community = this.get(CommunityService);
    for (const rating of RATINGS) {
      const routineId = this.routineId(rating.target);
      for (const [userKey, stars] of rating.stars) {
        // `rate` es upsert y recalcula el promedio en la misma transacción.
        await community.rate(this.seeded(userKey).actor, 'ROUTINE', routineId, stars);
        this.count('valoraciones');
      }
    }
  }

  private async seedComments(): Promise<void> {
    const community = this.get(CommunityService);
    const ids = new Map<string, string>();
    for (const c of COMMENTS) {
      const targetId = this.routineId(c.target);
      const author = this.seeded(c.author).actor;
      let existing = await ContentCommentModel.findOne({
        where: { targetKind: 'ROUTINE', targetId, authorId: author.id, text: c.text },
      });
      if (!existing) {
        const created = await community.create(author, 'ROUTINE', targetId, {
          text: c.text,
          replyToId: c.replyTo ? (ids.get(c.replyTo) ?? null) : null,
        });
        existing = await ContentCommentModel.findByPk(created.id, { rejectOnEmpty: true });
        this.count('comentarios_creados');
      }
      ids.set(c.key, existing.id);
      if (c.moderate && existing.status === 'VISIBLE') await this.moderate(existing.id, c.moderate);
    }
  }

  /** Denuncia real + veredicto «ocultar» de un moderador (aparece resuelto en el backoffice). */
  private async moderate(commentId: string, m: NonNullable<(typeof COMMENTS)[number]['moderate']>): Promise<void> {
    const moderation = this.get(ModerationService);
    const reporter = this.seeded(m.reporter).user;
    const asAuthenticated = (user: UserModel, scope: string | null): AuthenticatedUser => ({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId as string,
      tenantScope: scope,
      impersonating: false,
    });
    await moderation
      .report(asAuthenticated(reporter, reporter.tenantId), {
        targetKind: 'COMMENT',
        targetId: commentId,
        reason: m.reason,
        details: 'Publicidad de un plan de pago en los comentarios.',
      })
      .catch((error: unknown) => {
        // 409: ya estaba denunciado en una pasada anterior que no llegó a resolverse.
        if (!(error instanceof Error && error.name === 'ConflictException')) throw error;
      });
    const moderator = await this.moderatorUser();
    await moderation.resolve(asAuthenticated(moderator, null), 'COMMENT', commentId, {
      hideContent: true,
      sanction: false,
      note: 'Spam comercial (datos de demostración).',
    });
    this.count('comentarios_moderados');
  }

  /** El administrador de arranque si existe; si no, la cuenta de autoría de REPP. */
  private async moderatorUser(): Promise<UserModel> {
    const email = env.SEED_ADMIN_EMAIL?.toLowerCase();
    const admin = email ? await UserModel.findOne({ where: { email } }) : null;
    return admin ?? (await UserModel.findOne({ where: { email: OFFICIAL_AUTHOR_EMAIL }, rejectOnEmpty: true }));
  }

  private async seedLikesAndFavorites(): Promise<void> {
    const likes = this.get(ExerciseCommunityService);
    const preferences = this.get(MusclesService);
    const keys = DEMO_USERS.map((u) => u.key);
    for (const [index, externalId] of LIKED_EXERCISES.entries()) {
      const exerciseId = this.exerciseId(externalId);
      // Cada ejercicio, 2–4 «me gusta» de personas distintas y un favorito.
      const fans = [0, 1, 2, 3].slice(0, 2 + (index % 3)).map((offset) => keys[(index + offset * 3) % keys.length]);
      for (const fan of new Set(fans)) {
        await likes.setLike(this.seeded(fan).user.id, exerciseId, true);
        this.count('me_gusta');
      }
      await preferences.setPreference(this.seeded(keys[index % keys.length]).user.id, exerciseId, { isFavorite: true });
      this.count('favoritos');
    }
  }

  // ── Programas con historia ──────────────────────────────────────────────

  private realToday(): string {
    return new BusinessDateService().today();
  }

  /**
   * Activa el programa en la fecha simulada de inicio, registra las sesiones
   * de cada semana pasada en su día (reloj de negocio simulado) y deja que el
   * CIERRE SEMANAL REAL produzca el libro de recompensas.
   */
  private async ensureProgram(p: DemoProgram): Promise<void> {
    const { actor, user } = this.seeded(p.user);
    if (await TrainingProgramModel.findOne({ where: { userId: user.id, lane: 'STRENGTH', status: 'ACTIVE' } })) return;

    const routineId = 'plantilla' in p.source
      ? await this.ensureCopy(p.user, this.routineId(p.source.plantilla))
      : this.routineId(p.source.own);
    const routine = await RoutineModel.findByPk(routineId, { include: ['days', 'exercises'], rejectOnEmpty: true });
    const today = this.realToday();
    const start = addDays(mondayOf(today), -7 * p.weeksAgo);
    const liftTargets = [...new Set((routine.exercises ?? []).map((e) => e.exerciseId))].map((exerciseId) => ({
      ejercicioId: exerciseId,
      pesoTrabajoKg: this.kgFor(p, exerciseId),
    }));

    const programId = await this.withBusinessDate(start, async () => {
      const view = await this.get(ProgramsActivationService).activateStrength(
        actor,
        activateStrengthSchema.parse({ routineId, fechaInicio: start, modo: 'PROGRESSIVE_OVERLOAD', liftTargets }),
      );
      return view.id;
    });
    this.count('programas_activados');

    const days = [...(routine.days ?? [])].sort((a, b) => a.order - b.order);
    for (let week = 1; week <= p.weeksAgo; week += 1) {
      for (const day of days) {
        if (day.weekday == null || p.skipped.some(([w, d]) => w === week && d === day.weekday)) continue;
        const date = addDays(start, 7 * (week - 1) + day.weekday - 1);
        if (date >= today) continue;
        await this.withBusinessDate(date, () => this.trainDay(p, actor, routineId, day.id, date, week));
      }
    }
    const closed = await this.get(ProgramWeekCloseService).closeProgram(programId, today);
    this.count('semanas_cerradas', closed.length);
    this.count('semanas_cumplidas', closed.filter((w) => w.fulfilled).length);
  }

  private kgFor(p: DemoProgram, exerciseId: string): number {
    const external = [...this.exerciseIds].find(([, id]) => id === exerciseId)?.[0];
    return external === undefined ? 0 : (p.kg[external] ?? 0);
  }

  /** Una sesión completa del día: series en el tope de repeticiones con +2,5 kg por semana. */
  private async trainDay(p: DemoProgram, actor: Actor, routineId: string, dayId: string, date: string, week: number): Promise<void> {
    const workouts = this.get(WorkoutsService);
    const session = await this.get(TrainingService).startSessionFromRoutine(actor, routineId, dayId);
    for (const exercise of session.ejercicios) {
      if (exercise.duracionSeg != null) continue; // las series por tiempo no son series de fuerza
      const base = exercise.ejercicio ? this.kgFor(p, exercise.ejercicio.id) : 0;
      const kg = base > 0 ? base + 2.5 * (week - 1) : 0;
      const reps = exercise.repsMax ?? exercise.repsMin ?? 10;
      for (let n = 1; n <= (exercise.seriesObjetivo ?? 3); n += 1) {
        await workouts.addSet(
          actor.id,
          exercise.id,
          createWorkoutSetSchema.parse({ numeroSerie: n, repeticiones: reps, pesoKg: kg, rir: 2, descansoSegAnterior: n === 1 ? 0 : 90 }),
        );
      }
    }
    // Duración real de la sesión (≥ 10 min para que cuente) y, al terminar, su fecha simulada.
    await this.sequelize.query(`UPDATE public.sesiones_entrenamiento SET fecha_inicio = now() - interval '55 minutes' WHERE id = :id`, {
      replacements: { id: session.id },
    });
    await workouts.finishSession(actor.id, actor.tenantId, session.id);
    await this.sequelize.query(
      `UPDATE public.sesiones_entrenamiento
          SET fecha_inicio = (:date::date + time '18:05') AT TIME ZONE :tz,
              fecha_fin = (:date::date + time '19:00') AT TIME ZONE :tz
        WHERE id = :id`,
      { replacements: { id: session.id, date, tz: env.BUSINESS_TIME_ZONE }, type: QueryTypes.UPDATE },
    );
    this.count('sesiones_registradas');
  }

  /** Reloj de negocio simulado: todos los servicios leen `today()` del prototipo. */
  private async withBusinessDate<T>(date: string, task: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(BusinessDateService.prototype, 'today');
    Object.defineProperty(BusinessDateService.prototype, 'today', { value: () => date, configurable: true, writable: true });
    try {
      return await task();
    } finally {
      if (original) Object.defineProperty(BusinessDateService.prototype, 'today', original);
    }
  }
}

export async function runRoutinesShowcase(app: INestApplicationContext): Promise<ShowcaseCounters> {
  assertShowcaseAllowed(env.NODE_ENV);
  const counters = await new RoutinesShowcaseSeeder(app, resolveShowcasePassword()).run();
  logger.log({ event: 'database.seed.showcase.completed', ...counters });
  return counters;
}
