import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { UserGender } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { resolveMediaUrl } from "../../common/media/media-url";
import { badgeIllustration, rarityRank } from "./badge-illustrations";
import { UsersRepository } from "../users/users.repository";
import { ChallengeTotals } from "./challenges.repository";
import { ProgressionBadgeModel } from "./progression-badge.model";
import { ProgressionLevelModel } from "./progression-level.model";
import {
  ProgressionRepository,
  STREAK_FREEZE_EVERY_DAYS,
  STREAK_MAX_FREEZES,
  TrainingMetrics,
} from "./progression.repository";
import type { BadgeCriterionType, ProgressionAudience } from "./progression-catalog";
import { PrizeView, toPrizeView } from "./prizes";
import { PrizeRecord, PrizesRepository } from "./prizes.repository";
import { UserBadgeModel } from "./user-badge.model";
import {
  MONTHLY_STRIKES_BASE,
  STRIKE_POINT_COST,
  MISSED_SESSION_PENALTY,
} from "./user-streak-strike.model";
import {
  CHALLENGE_POINTS,
  ChallengeDifficulty,
  ChallengeView,
  PERFECT_WEEK_BONUS,
  WeeklyChallengesView,
  mondayOfDate,
} from "./weekly-challenges";
import { WeeklyChallengesService } from "./weekly-challenges.service";
import { buildArenas, earnedPoints, type ArenaView } from "./progression-arenas";

/**
 * Cuánto vale cada cosa.
 *
 * La escala se eligió para que una sesión normal —unas veinte series y cinco
 * toneladas— ronde los 150 puntos, que es la unidad con la que están calibrados
 * los umbrales de los rangos. Cambiar estos números sin mover los umbrales
 * recoloca a todo el gimnasio de golpe, así que van juntos.
 */
export const POINTS = {
  /** Aparecer y terminar. Es lo que el producto quiere que se repita. */
  perSession: 50,
  /** El trabajo real dentro de la sesión. */
  perSet: 2,
  /** Cien kilos movidos = 1 punto. Premia el esfuerzo sin que el peso lo domine todo. */
  perVolumeUnitKg: 100,
  /**
   * La racha se paga sobre la **más larga**, no sobre la vigente: los puntos
   * son un historial y no deberían bajar por un descanso. La racha en curso ya
   * tiene su propio sitio destacado en la pantalla.
   */
  perLongestStreakDay: 10,
  /** SISTEMA DE PROGRESOS: Puntos por batir un récord personal (PR). */
  perPersonalRecord: 25,
  /** Penalización por falta a sesión planificada no repuesta dentro de la semana. */
  penaltyMissedSession: MISSED_SESSION_PENALTY,
  /** Coste en puntos para intercambiar/comprar 1 strike cuando se agotan los mensuales. */
  strikeCost: STRIKE_POINT_COST,
} as const;

/**
 * Hitos de racha con carta propia. La pantalla enseña el siguiente («te faltan
 * 3 días para 30»): una meta a la vista aprieta el paso, una lejana no.
 */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365] as const;

/** De dónde sale cada punto. La suma de las partes es el total. */
export interface PointsBreakdown {
  session: number;
  sets: number;
  volume: number;
  streak: number;
  /** SISTEMA DE PROGRESOS: puntos por récords personales (PRs). */
  progress: number;
  badges: number;
  /** Bonos de los programas con modo (multiplicador semanal y metas). Nunca bajan. */
  modes: number;
  /** Retos de la semana cumplidos más los bonos de semana redonda. Nunca bajan. */
  challenges: number;
  /** Penalización por faltas no repuestas a días planificados. */
  penalties: number;
  /** Puntos canjeados para recomprar strikes. */
  strikePurchases: number;
}

export interface StreakView {
  /** Días, ya con comodines aplicados. */
  current: number;
  longest: number;
  /** Comodines guardados ahora (0..2). */
  freezes: number;
  /** Comodines gastados en la racha vigente. */
  freezesUsed: number;
  nextMilestone: number | null;
  /** = `stats.weeklyStreak`. */
  weekly: number;
}

/**
 * Lo que una sesión recién terminada movió en la senda.
 *
 * Existe para que el cliente pueda enseñar causa y efecto en el momento en que
 * ocurre —«+74 puntos: 50 por terminar, 16 por las series, 8 por los kilos»— y
 * abrir la carta de cada insignia ganada sin tener que adivinar qué cambió.
 */
export interface SessionRewardView {
  pointsBefore: number;
  pointsAfter: number;
  pointsEarned: number;
  /** Diferencia por partida entre antes y después de la sesión. */
  breakdown: PointsBreakdown;
  levelBefore: LevelView | null;
  levelAfter: LevelView | null;
  leveledUp: boolean;
  nextLevel: LevelView | null;
  pointsToNextLevel: number | null;
  /** Avance dentro del tramo del rango anterior, para animar la barra desde ahí. */
  levelProgressBefore: number;
  levelProgress: number;
  unlockedNow: BadgeView[];
  /** Retos de la semana DESPUÉS de la sesión: «2 de 3», con la barra a medio llenar. */
  challenges: WeeklyChallengesView;
  challengesCompletedNow: ChallengeView[];
  perfectWeekNow: boolean;
  prizesNow: PrizeView[];
  streak: { current: number; freezes: number; freezeEarnedNow: boolean; milestoneNow: number | null };
  /** Lo más cerca: lo que trae de vuelta al socio la próxima vez. */
  nearest: BadgeView[];
}

/** Las reglas publicadas, para que los clientes las expliquen sin copiarlas. */
export interface PointRulesView {
  perSession: number;
  perSet: number;
  perVolumeUnitKg: number;
  perLongestStreakDay: number;
  perPersonalRecord: number;
  penaltyMissedSession: number;
  strikeCost: number;
  monthlyStrikes: number;
  challengePoints: Record<ChallengeDifficulty, number>;
  perfectWeekBonus: number;
  freezeEveryDays: number;
  maxFreezes: number;
}

interface ProgressionSnapshot {
  points: number;
  breakdown: PointsBreakdown;
  level: LevelView | null;
  levelProgress: number;
  challenges: WeeklyChallengesView;
  streak: { current: number; freezesEarned: number };
}

export interface LevelView {
  code: string;
  name: string;
  tagline: string;
  description: string | null;
  minPoints: number;
  sortOrder: number;
  icon: string;
  color: string;
  /** Alcanzado con los puntos actuales. */
  unlocked: boolean;
  /** El rango en el que se está ahora mismo. */
  current: boolean;
}

export interface BadgeView {
  code: string;
  name: string;
  description: string;
  flavorText: string | null;
  category: string;
  rarity: string;
  /** 1 común … 4 legendaria. */
  rarityRank: number;
  icon: string;
  /** Clave de la ilustración grande de la carta (ver `badge-illustrations.ts`). */
  illustration: string;
  color: string;
  pointsReward: number;
  secret: boolean;
  /** Qué mide y cuánto pide, para que la carta pueda pintar la unidad. */
  criterion: BadgeCriterionType;
  threshold: number;
  earned: boolean;
  earnedAt: string | null;
  /** Novedad desde la última vez que se abrió la pantalla. */
  isNew: boolean;
  /** Progreso hacia el umbral, de 0 a 1. Nulo en las secretas no conseguidas. */
  progress: number | null;
  progressLabel: string | null;
  /**
   * Cadena a la que pertenece: el criterio. Las insignias del mismo criterio se
   * ven como una sola ficha «Nivel 2 de 4» en vez de cuatro fichas sueltas.
   */
  chain: string;
  /** Posición en la cadena por umbral, empezando en 1. */
  chainStep: number;
  chainLength: number;
}

export interface ProgressionView {
  points: number;
  audience: ProgressionAudience;
  level: LevelView | null;
  nextLevel: LevelView | null;
  pointsToNextLevel: number | null;
  /** Avance dentro del tramo actual, de 0 a 1. Uno cuando ya no hay siguiente. */
  levelProgress: number;
  path: LevelView[];
  /** Puntos ganados en total (sin descontar canjes ni penalizaciones): lo que mueve el camino. */
  arenaPoints: number;
  /** El camino de arenas (lugares), más fino que los rangos. */
  arenas: ArenaView[];
  badges: BadgeView[];
  stats: {
    totalSessions: number;
    totalSets: number;
    totalReps: number;
    totalVolumeKg: number;
    currentStreakDays: number;
    longestStreakDays: number;
    weeklyStreak: number;
    distinctExercises: number;
    distinctMuscleGroups: number;
    personalRecords: number;
    lastSessionOn: string | null;
  };
  /** Insignias conseguidas en este mismo recálculo, para poder celebrarlas. */
  unlockedNow: BadgeView[];
  streak: StreakView;
  strikes: {
    totalMonthly: number;
    available: number;
    usedThisMonth: number;
    purchasedThisMonth: number;
    strikeCostPoints: number;
    month: string;
    /** Faltas de esta semana que aún se pueden reponer entrenando un día de descanso. */
    pendingThisWeek: number;
    /** Puntos perdidos por faltas sin strike, en toda la historia. */
    penaltyPointsTotal: number;
  };
  challenges: WeeklyChallengesView;
  /** Cupones del socio, del más reciente al más antiguo. */
  prizes: PrizeView[];
  /** Hasta tres insignias sin conseguir (ni secretas), de más a menos avanzada. */
  nearest: BadgeView[];
}

/** Lo que `getProgression` calcula además de la vista, para el premio de una sesión. */
interface ProgressionComputation {
  view: ProgressionView;
  breakdown: PointsBreakdown;
  prizesNowIds: ReadonlySet<string>;
  freezesEarned: number;
}

/** Cuántas insignias enseña «Lo más cerca». */
const NEAREST_LIMIT = 3;

@Injectable()
export class ProgressionService {
  constructor(
    private readonly progressionRepository: ProgressionRepository,
    private readonly usersRepository: UsersRepository,
    private readonly challenges: WeeklyChallengesService,
    private readonly prizes: PrizesRepository,
  ) {}

  /**
   * Estado completo de la senda de un usuario.
   *
   * Recalcula en cada lectura en vez de mantener un contador incremental. Es
   * más caro, pero es lo único que sobrevive a que un administrador cambie un
   * umbral o a que se corrija una serie mal registrada: con un contador, esos
   * dos casos dejarían el marcador desviado para siempre y sin forma de saberlo.
   */
  async getProgression(userId: string): Promise<ProgressionView> {
    return (await this.computeProgression(userId)).view;
  }

  /** Los cupones del socio: lo mismo que `progression.prizes`, ya otorgado lo que tocara. */
  async getPrizes(userId: string): Promise<PrizeView[]> {
    return (await this.getProgression(userId)).prizes;
  }

  private async computeProgression(userId: string): Promise<ProgressionComputation> {
    const context = await this.loadContext(userId);
    const { audience, tenantId, levels, badges, earned } = context;

    // Los retos van antes que las insignias: cumplirlos cuenta para las de
    // «retos cumplidos» y «semanas redondas», y sus puntos entran en el total.
    const challengeState = await this.challenges.sync(userId);
    const metrics = withChallengeTotals(context.metrics, challengeState.totals);

    const earnedByBadgeId = new Map(earned.map((row) => [row.badgeId, row]));

    // Primera pasada: qué insignias cumple ahora. Se resuelve antes de sumar
    // puntos porque cada insignia aporta los suyos.
    const satisfied = badges.filter(
      (badge) => measure(metrics, badge.criterionType) >= Number(badge.criterionThreshold),
    );

    const newlyEarned = satisfied.filter((badge) => !earnedByBadgeId.has(badge.id));
    if (newlyEarned.length > 0) {
      await this.progressionRepository.awardBadges(
        userId,
        newlyEarned.map((badge) => ({
          badgeId: badge.id,
          progressValue: measure(metrics, badge.criterionType),
        })),
      );
    }
    const newlyEarnedIds = new Set(newlyEarned.map((badge) => badge.id));

    const currentMonth = currentMonthString();
    const strikes = strikeStateOf(metrics, currentMonth);
    // Foto de lo calculado en la tabla de strikes (la verdad es el historial).
    const settlement = metrics.strikeSettlement;
    if (settlement) {
      await this.progressionRepository.syncStrikeLedger(
        userId,
        settlement.usedByMonth,
        Object.fromEntries(
          Object.entries(settlement.penalizedByMonth).map(([month, count]) => [month, count * MISSED_SESSION_PENALTY]),
        ),
      );
    }

    // Los puntos de una insignia ya conseguida no se devuelven: archivar una
    // rutina o borrar un comentario puede dejar de cumplir la regla, pero los
    // puntos son un historial y no deben bajar.
    const breakdown = computePointsBreakdown(
      metrics,
      badges.filter((badge) => satisfied.includes(badge) || earnedByBadgeId.has(badge.id)),
      strikes.ledger,
    );
    const points = sumBreakdown(breakdown);
    const path = buildPath(levels, points);
    // El rango vigente es el último desbloqueado. Se busca por índice y no con
    // `findLast` porque la librería de destino de este proyecto no lo incluye.
    const current = path.filter((level) => level.unlocked).at(-1) ?? null;
    const next = path.find((level) => !level.unlocked) ?? null;

    // Los premios se otorgan ANTES de guardar el progreso: el de un rango se
    // decide comparando con el rango guardado, y si el otorgamiento fallara a
    // medias, la siguiente lectura todavía vería el cruce y lo reintentaría.
    const previous = await this.progressionRepository.findProgress(userId);
    const prizesNowIds = await this.grantPrizes({
      userId,
      tenantId,
      badges,
      earnedByBadgeId,
      newlyEarnedIds,
      path,
      previousLevelCode: previous?.levelCode ?? null,
      perfectWeekStarts: challengeState.totals.perfectWeekStarts,
    });

    await this.progressionRepository.saveProgress(userId, {
      points,
      levelCode: current?.code ?? null,
      currentStreakDays: metrics.currentStreakDays,
      longestStreakDays: metrics.longestStreakDays,
      lastSessionOn: metrics.lastSessionOn,
      totalSessions: metrics.totalSessions,
      totalSets: metrics.totalSets,
      totalVolumeKg: metrics.totalVolumeKg,
    });

    const chains = chainPositions(badges);
    const badgeViews = badges.map((badge) =>
      toBadgeView(badge, metrics, earnedByBadgeId, newlyEarnedIds, chains),
    );
    // Las secretas no conseguidas no se listan: anunciarlas las convertiría en
    // una lista de tareas y perderían lo único que aportan, la sorpresa.
    const visible = badgeViews.filter((view) => view.earned || !view.secret);
    const coupons = await this.prizes.listCoupons(userId);

    return {
      view: {
        points,
        audience,
        level: current,
        nextLevel: next,
        pointsToNextLevel: next ? Math.max(0, next.minPoints - points) : null,
        levelProgress: tierProgress(points, current, next),
        path,
        // El camino sube con lo ganado, no con el saldo: canjear o perder puntos
        // no puede devolver a nadie a una arena anterior.
        arenaPoints: earnedPoints(breakdown),
        arenas: buildArenas(audience, earnedPoints(breakdown)),
        badges: visible,
        stats: {
          totalSessions: metrics.totalSessions,
          totalSets: metrics.totalSets,
          totalReps: metrics.totalReps,
          totalVolumeKg: Math.round(metrics.totalVolumeKg),
          currentStreakDays: metrics.currentStreakDays,
          longestStreakDays: metrics.longestStreakDays,
          weeklyStreak: metrics.weeklyStreak,
          distinctExercises: metrics.distinctExercises,
          distinctMuscleGroups: metrics.distinctMuscleGroups,
          personalRecords: metrics.personalRecords,
          lastSessionOn: metrics.lastSessionOn,
        },
        unlockedNow: badgeViews.filter((view) => newlyEarnedIds.has(idOf(badges, view.code))),
        streak: toStreakView(metrics),
        strikes: strikes.view,
        challenges: challengeState.view,
        prizes: coupons.map((coupon) => toPrizeView(coupon, prizeSourceName(coupon, badges, path))),
        nearest: pickNearest(visible),
      },
      breakdown,
      prizesNowIds,
      freezesEarned: metrics.streakFreezesEarned ?? 0,
    };
  }

  private async loadContext(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado.");

    const audience = toAudience(user.gender);
    const tenantId = user.tenantId ?? env.DEFAULT_TENANT_ID ?? null;

    const [metrics, levels, badges, earned] = await Promise.all([
      this.progressionRepository.computeMetrics(userId),
      this.progressionRepository.listLevels(tenantId, audience),
      this.progressionRepository.listBadges(tenantId, audience),
      this.progressionRepository.listUserBadges(userId),
    ]);
    return { audience, tenantId, metrics, levels, badges, earned };
  }

  /**
   * Foto de la senda **sin efectos**: no otorga insignias ni guarda progreso.
   *
   * Se toma justo antes de cerrar una sesión para poder decir después cuánto
   * movió esa sesión en concreto. Si otorgara, las insignias ganadas antes y
   * todavía sin recalcular se contarían como fruto de esta sesión.
   */
  async snapshot(userId: string): Promise<ProgressionSnapshot> {
    const context = await this.loadContext(userId);
    const challengeState = await this.challenges.preview(userId);
    const metrics = withChallengeTotals(context.metrics, challengeState.totals);
    const { levels, badges, earned } = context;
    const strikes = strikeStateOf(metrics, currentMonthString());

    const earnedIds = new Set(earned.map((row) => row.badgeId));
    const satisfied = badges.filter(
      (badge) =>
        earnedIds.has(badge.id) ||
        measure(metrics, badge.criterionType) >= Number(badge.criterionThreshold),
    );
    const breakdown = computePointsBreakdown(metrics, satisfied, strikes.ledger);
    const points = sumBreakdown(breakdown);
    const path = buildPath(levels, points);
    const level = path.filter((entry) => entry.unlocked).at(-1) ?? null;
    const next = path.find((entry) => !entry.unlocked) ?? null;
    return {
      points,
      breakdown,
      level,
      levelProgress: tierProgress(points, level, next),
      challenges: challengeState.view,
      streak: { current: metrics.currentStreakDays, freezesEarned: metrics.streakFreezesEarned ?? 0 },
    };
  }

  /**
   * Recalcula la senda tras una sesión y la compara con la foto previa.
   *
   * Pasa por `getProgression`, así que otorga las insignias, retos y premios
   * recién cumplidos y guarda el progreso exactamente igual que abrir la
   * pantalla de la senda.
   */
  async recordSessionReward(
    userId: string,
    before: ProgressionSnapshot,
  ): Promise<SessionRewardView> {
    const { view: after, breakdown, prizesNowIds, freezesEarned } = await this.computeProgression(userId);
    const delta = (key: keyof PointsBreakdown) => Math.max(0, breakdown[key] - before.breakdown[key]);

    // Si la semana cambió entre la foto y el cálculo (cerrar justo a medianoche
    // del domingo), todo lo cumplido de la semana nueva es de esta sesión.
    const sameWeek = before.challenges.weekStart === after.challenges.weekStart;
    const doneBefore = new Set(
      sameWeek ? before.challenges.items.filter((item) => item.completed).map((item) => item.code) : [],
    );
    const milestoneNow =
      STREAK_MILESTONES.filter((days) => before.streak.current < days && days <= after.streak.current).at(-1) ??
      null;

    return {
      pointsBefore: before.points,
      pointsAfter: after.points,
      pointsEarned: Math.max(0, after.points - before.points),
      breakdown: {
        session: delta("session"),
        sets: delta("sets"),
        volume: delta("volume"),
        streak: delta("streak"),
        progress: delta("progress"),
        badges: delta("badges"),
        modes: delta("modes"),
        challenges: delta("challenges"),
        penalties: delta("penalties"),
        strikePurchases: delta("strikePurchases"),
      },
      levelBefore: before.level,
      levelAfter: after.level,
      leveledUp: (after.level?.sortOrder ?? -1) > (before.level?.sortOrder ?? -1),
      nextLevel: after.nextLevel,
      pointsToNextLevel: after.pointsToNextLevel,
      levelProgressBefore: before.levelProgress,
      levelProgress: after.levelProgress,
      unlockedNow: after.unlockedNow,
      challenges: after.challenges,
      challengesCompletedNow: after.challenges.items.filter(
        (item) => item.completed && !doneBefore.has(item.code),
      ),
      perfectWeekNow: after.challenges.perfect && !(sameWeek && before.challenges.perfect),
      prizesNow: after.prizes.filter((prize) => prizesNowIds.has(prize.id)),
      streak: {
        current: after.streak.current,
        freezes: after.streak.freezes,
        freezeEarnedNow: freezesEarned > before.streak.freezesEarned,
        milestoneNow,
      },
      nearest: after.nearest,
    };
  }

  getRules(): PointRulesView {
    return {
      ...POINTS,
      monthlyStrikes: MONTHLY_STRIKES_BASE,
      challengePoints: { ...CHALLENGE_POINTS },
      perfectWeekBonus: PERFECT_WEEK_BONUS,
      freezeEveryDays: STREAK_FREEZE_EVERY_DAYS,
      maxFreezes: STREAK_MAX_FREEZES,
    };
  }

  /**
   * Canjea puntos acumulados por un strike mensual adicional (150 puntos por strike).
   */
  async buyStrike(userId: string): Promise<ProgressionView> {
    const bought = await this.progressionRepository.buyStrikeAtomically(
      userId,
      currentMonthString(),
      // Se evalúa con el candado del socio tomado: dos compras a la vez no
      // pueden gastar los mismos puntos.
      async () => (await this.computeProgression(userId)).view.points >= POINTS.strikeCost,
    );
    if (!bought) {
      throw new BadRequestException(
        `No tienes suficientes puntos para canjear un strike (requiere ${POINTS.strikeCost} puntos).`,
      );
    }
    return (await this.computeProgression(userId)).view;
  }

  /**
   * Otorga los cupones de los premios cuyo hito se acaba de alcanzar.
   *
   * Las recompensas por racha antiguas (`STREAK_REWARD_*`) ya no se otorgan:
   * los premios las sustituyen. Las ya dadas siguen en «Accesos».
   *
   * Un premio no es retroactivo: el gimnasio que crea hoy «batido gratis por
   * Treinta días de fuego» no regala de golpe un batido a cada socio que ya la
   * tenía (y se quedaría sin stock en una tarde). Cuenta lo conseguido desde
   * que el premio existe:
   *
   * - **Insignia**: conseguida en o después de la creación del premio.
   * - **Rango**: cruzado ahora (el guardado era inferior).
   * - **Semana redonda**: cada una desde la semana en que se creó el premio.
   *
   * Devuelve los ids de los cupones nacidos en esta llamada.
   */
  private async grantPrizes(input: {
    userId: string;
    tenantId: string | null;
    badges: readonly ProgressionBadgeModel[];
    earnedByBadgeId: ReadonlyMap<string, UserBadgeModel>;
    newlyEarnedIds: ReadonlySet<string>;
    path: readonly LevelView[];
    previousLevelCode: string | null;
    perfectWeekStarts: readonly string[];
  }): Promise<Set<string>> {
    const granted = new Set<string>();
    const catalog = await this.prizes.listActiveFor(input.tenantId);
    if (catalog.length === 0) return granted;

    const existing = new Set(
      (await this.prizes.listCoupons(input.userId)).map((coupon) => `${coupon.prizeId}:${coupon.sourceRef}`),
    );
    for (const prize of catalog) {
      for (const sourceRef of milestoneRefs(prize, input)) {
        if (existing.has(`${prize.id}:${sourceRef}`)) continue;
        const coupon = await this.prizes.grant(prize.id, input.userId, sourceRef);
        if (coupon) granted.add(coupon.id);
      }
    }
    return granted;
  }

  /** Marca como vistas las novedades —insignias, retos y cupones— para que dejen de celebrarse. */
  async acknowledge(userId: string): Promise<{ acknowledged: true }> {
    await Promise.all([
      this.progressionRepository.markBadgesSeen(userId),
      this.challenges.acknowledge(userId),
      this.prizes.markSeen(userId),
    ]);
    return { acknowledged: true };
  }

  async getRestDays(userId: string): Promise<{ weekdays: number[] }> {
    const weekdays = await this.progressionRepository.getRestWeekdays(userId);
    return { weekdays: [...weekdays].sort((a, b) => a - b) };
  }

  async setRestDays(userId: string, weekdays: readonly number[]): Promise<{ weekdays: number[] }> {
    await this.progressionRepository.setRestWeekdays(userId, weekdays);
    return this.getRestDays(userId);
  }

  async getLeaderboard(userId: string, limit: number, sortBy: "points" | "streak" = "points") {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado.");
    const tenantId = user.tenantId ?? env.DEFAULT_TENANT_ID ?? null;
    const rows = await this.progressionRepository.leaderboard(tenantId, limit, sortBy, userId);
    return rows.map((row, index) => ({
      position: index + 1,
      userId: row.userId,
      points: Number(row.points),
      levelCode: row.levelCode,
      streakDays: Number(row.currentStreakDays),
      // Solo el nombre de pila y la inicial: una tabla pública con el nombre
      // completo de cada socio es una lista de clientes del gimnasio.
      displayName: shortenName(row.fullName),
      photoUrl: resolveMediaUrl(row.photoUrl),
      badges: Array.isArray(row.badges) ? row.badges : [],
      isMe: row.userId === userId,
    }));
  }
}

/** Qué cupones pide un premio para este socio ahora (ver `grantPrizes`). */
function milestoneRefs(
  prize: PrizeRecord,
  input: {
    badges: readonly ProgressionBadgeModel[];
    earnedByBadgeId: ReadonlyMap<string, UserBadgeModel>;
    newlyEarnedIds: ReadonlySet<string>;
    path: readonly LevelView[];
    previousLevelCode: string | null;
    perfectWeekStarts: readonly string[];
  },
): string[] {
  const createdAt = new Date(prize.createdAt);
  switch (prize.targetKind) {
    case "BADGE": {
      const badge = input.badges.find((entry) => entry.code === prize.targetCode);
      if (!badge) return [];
      const earnedAt = input.newlyEarnedIds.has(badge.id)
        ? new Date()
        : input.earnedByBadgeId.get(badge.id)?.awardedAt ?? null;
      return earnedAt !== null && earnedAt.getTime() >= createdAt.getTime() ? [badge.code] : [];
    }
    case "LEVEL": {
      const level = input.path.find((entry) => entry.code === prize.targetCode);
      if (!level?.unlocked) return [];
      const previousOrder =
        input.path.find((entry) => entry.code === input.previousLevelCode)?.sortOrder ?? -1;
      return previousOrder < level.sortOrder ? [level.code] : [];
    }
    case "PERFECT_WEEK": {
      const firstWeek = mondayOfDate(createdAt.toISOString().slice(0, 10));
      return input.perfectWeekStarts.filter((week) => week >= firstWeek);
    }
  }
}

function prizeSourceName(
  coupon: { targetKind: PrizeRecord["targetKind"]; targetCode: string },
  badges: readonly ProgressionBadgeModel[],
  path: readonly LevelView[],
): string {
  switch (coupon.targetKind) {
    case "BADGE":
      return badges.find((badge) => badge.code === coupon.targetCode)?.name ?? coupon.targetCode;
    case "LEVEL":
      return path.find((level) => level.code === coupon.targetCode)?.name ?? coupon.targetCode;
    case "PERFECT_WEEK":
      return "Semana redonda";
  }
}

function withChallengeTotals(metrics: TrainingMetrics, totals: ChallengeTotals): TrainingMetrics {
  return {
    ...metrics,
    challengesCompleted: totals.completed,
    perfectWeeks: totals.perfectWeeks,
    challengePoints: totals.points,
  };
}

export function nextStreakMilestone(current: number): number | null {
  return STREAK_MILESTONES.find((days) => days > current) ?? null;
}

function toStreakView(metrics: TrainingMetrics): StreakView {
  return {
    current: metrics.currentStreakDays,
    longest: metrics.longestStreakDays,
    freezes: metrics.streakFreezes ?? 0,
    freezesUsed: metrics.streakFreezesUsed ?? 0,
    nextMilestone: nextStreakMilestone(metrics.currentStreakDays),
    weekly: metrics.weeklyStreak,
  };
}

/**
 * «Lo más cerca»: las insignias sin conseguir con más progreso. Ni secretas
 * (no se anuncian) ni conseguidas. A igualdad de progreso manda el orden del
 * catálogo, que pone primero lo más básico.
 */
export function pickNearest(badges: readonly BadgeView[], limit: number = NEAREST_LIMIT): BadgeView[] {
  return badges
    .filter((badge) => !badge.earned && !badge.secret)
    .map((badge, index) => ({ badge, index }))
    .sort((left, right) => (right.badge.progress ?? 0) - (left.badge.progress ?? 0) || left.index - right.index)
    .slice(0, limit)
    .map(({ badge }) => badge);
}

/** Posición de cada insignia en su cadena (mismo criterio, ordenadas por umbral). */
export function chainPositions(
  badges: readonly Pick<ProgressionBadgeModel, "code" | "criterionType" | "criterionThreshold" | "secret">[],
): Map<string, { chain: string; chainStep: number; chainLength: number }> {
  const byChain = new Map<string, typeof badges[number][]>();
  for (const badge of badges) {
    // Las secretas forman cadena aparte: contarlas en la pública delataría que existen.
    const key = `${badge.criterionType}:${badge.secret ? "S" : "P"}`;
    byChain.set(key, [...(byChain.get(key) ?? []), badge]);
  }
  const positions = new Map<string, { chain: string; chainStep: number; chainLength: number }>();
  for (const members of byChain.values()) {
    const sorted = [...members].sort(
      (left, right) => Number(left.criterionThreshold) - Number(right.criterionThreshold),
    );
    sorted.forEach((badge, index) =>
      positions.set(badge.code, { chain: badge.criterionType, chainStep: index + 1, chainLength: sorted.length }),
    );
  }
  return positions;
}

function idOf(badges: readonly ProgressionBadgeModel[], code: string): string {
  return badges.find((badge) => badge.code === code)?.id ?? "";
}

export function toAudience(gender: UserGender | null): ProgressionAudience {
  if (gender === UserGender.MALE) return "MALE";
  if (gender === UserGender.FEMALE) return "FEMALE";
  return "ANY";
}

export function computePointsBreakdown(
  metrics: TrainingMetrics,
  earnedBadges: readonly { pointsReward: number }[],
  strikes?: { penaltyPoints?: number; purchasedStrikes?: number },
): PointsBreakdown {
  const penaltyPoints = strikes?.penaltyPoints ?? 0;
  const purchasedStrikes = strikes?.purchasedStrikes ?? 0;
  return {
    session: metrics.totalSessions * POINTS.perSession,
    sets: metrics.totalSets * POINTS.perSet,
    volume: Math.floor(metrics.totalVolumeKg / POINTS.perVolumeUnitKg),
    streak: metrics.longestStreakDays * POINTS.perLongestStreakDay,
    progress: (metrics.personalRecords ?? 0) * POINTS.perPersonalRecord,
    badges: earnedBadges.reduce((total, badge) => total + badge.pointsReward, 0),
    modes: metrics.modeBonusPoints ?? 0,
    challenges: metrics.challengePoints ?? 0,
    penalties: penaltyPoints,
    strikePurchases: purchasedStrikes * POINTS.strikeCost,
  };
}

function sumBreakdown(breakdown: PointsBreakdown): number {
  const positive =
    breakdown.session +
    breakdown.sets +
    breakdown.volume +
    breakdown.streak +
    (breakdown.progress ?? 0) +
    breakdown.badges +
    breakdown.modes +
    breakdown.challenges;
  const negative = (breakdown.penalties ?? 0) + (breakdown.strikePurchases ?? 0);
  return Math.max(0, positive - negative);
}

export function computePoints(
  metrics: TrainingMetrics,
  earnedBadges: readonly { pointsReward: number }[],
  strikes?: { penaltyPoints?: number; purchasedStrikes?: number },
): number {
  return sumBreakdown(computePointsBreakdown(metrics, earnedBadges, strikes));
}

/** Métrica que mide cada criterio. Un `switch` exhaustivo: si se añade un criterio al catálogo, el compilador obliga a medirlo. */
export function measure(metrics: TrainingMetrics, criterion: BadgeCriterionType): number {
  switch (criterion) {
    case "SESSION_COUNT":
      return metrics.totalSessions;
    case "STREAK_DAYS":
      return metrics.longestStreakDays;
    case "WEEKLY_STREAK":
      return metrics.weeklyStreak;
    case "TOTAL_VOLUME_KG":
      return metrics.totalVolumeKg;
    case "SINGLE_SESSION_VOLUME_KG":
      return metrics.maxSessionVolumeKg;
    case "TOTAL_SETS":
      return metrics.totalSets;
    case "TOTAL_REPS":
      return metrics.totalReps;
    case "DISTINCT_MUSCLE_GROUPS":
      return metrics.distinctMuscleGroups;
    case "DISTINCT_EXERCISES":
      return metrics.distinctExercises;
    case "EARLY_SESSIONS":
      return metrics.earlySessions;
    case "NIGHT_SESSIONS":
      return metrics.nightSessions;
    case "WEEKEND_SESSIONS":
      return metrics.weekendSessions;
    case "PERSONAL_RECORDS":
      return metrics.personalRecords;
    case "OVERLOAD_WEEKS_STREAK":
      return metrics.overloadWeeksStreak ?? 0;
    case "MODE_MULTIPLIER_MAX":
      return metrics.modeMultiplierMax ?? 0;
    case "STRENGTH_GOAL_REACHED":
      return metrics.strengthGoalsReached ?? 0;
    case "CARDIO_WEEKLY_MINUTES":
      return metrics.cardioWeeklyStreak ?? 0;
    case "TOTAL_TRAINING_MINUTES":
      return metrics.totalTrainingMinutes ?? 0;
    case "MAX_SET_WEIGHT_KG":
      return metrics.maxSetWeightKg ?? 0;
    case "TIMED_SECONDS_TOTAL":
      return metrics.timedSecondsTotal ?? 0;
    case "CARDIO_TOTAL_MINUTES":
      return metrics.cardioTotalMinutes ?? 0;
    case "CARDIO_TOTAL_KM":
      return metrics.cardioTotalKm ?? 0;
    case "MONDAY_SESSIONS":
      return metrics.mondaySessions ?? 0;
    case "DISTINCT_WEEKDAYS":
      return metrics.distinctWeekdays ?? 0;
    case "MAX_SESSIONS_IN_WEEK":
      return metrics.maxSessionsInWeek ?? 0;
    case "GEO_VERIFIED_SESSIONS":
      return metrics.geoVerifiedSessions ?? 0;
    case "SUPERSET_SESSIONS":
      return metrics.supersetSessions ?? 0;
    case "ROUTINES_CREATED":
      return metrics.routinesCreated ?? 0;
    case "ROUTINES_PUBLISHED":
      return metrics.routinesPublished ?? 0;
    case "ROUTINE_COPIES_RECEIVED":
      return metrics.routineCopiesReceived ?? 0;
    case "COMMENTS_WRITTEN":
      return metrics.commentsWritten ?? 0;
    case "RATINGS_GIVEN":
      return metrics.ratingsGiven ?? 0;
    case "COMMENT_LIKES_RECEIVED":
      return metrics.commentLikesReceived ?? 0;
    case "CHALLENGES_COMPLETED":
      return metrics.challengesCompleted ?? 0;
    case "PERFECT_WEEKS":
      return metrics.perfectWeeks ?? 0;
    case "COMEBACK_SESSIONS":
      return metrics.comebackSessions ?? 0;
    case "MAX_SESSIONS_IN_DAY":
      return metrics.maxSessionsInDay ?? 0;
    case "LONGEST_SESSION_MINUTES":
      return metrics.longestSessionMinutes ?? 0;
    case "MIDNIGHT_SESSIONS":
      return metrics.midnightSessions ?? 0;
    case "NEW_YEAR_SESSIONS":
      return metrics.newYearSessions ?? 0;
    case "BIRTHDAY_SESSIONS":
      return metrics.birthdaySessions ?? 0;
    case "MAX_RECORDS_IN_SESSION":
      return metrics.maxRecordsInSession ?? 0;
    case "MODE_SHIELDS_USED":
      return metrics.modeShieldsUsed ?? 0;
    case "MODE_MAX_MULTIPLIER_WEEKS":
      return metrics.modeMaxMultiplierWeeks ?? 0;
    case "GYM_SOCIAL_PARTNERS":
      return metrics.gymSocialPartners ?? 0;
    case "COACH_SESSIONS":
      return metrics.coachSessions ?? 0;
    case "COACH_CLIENTS":
      return metrics.coachClients ?? 0;
    case "COACH_CLIENTS_PRS":
      return metrics.coachClientsPrs ?? 0;
  }
}

function buildPath(levels: readonly ProgressionLevelModel[], points: number): LevelView[] {
  const unlockedCount = levels.filter((level) => points >= level.minPoints).length;
  return levels.map((level, index) => ({
    code: level.code,
    name: level.name,
    tagline: level.tagline,
    description: level.description,
    minPoints: level.minPoints,
    sortOrder: level.sortOrder,
    icon: level.icon,
    color: level.color,
    unlocked: points >= level.minPoints,
    current: index === unlockedCount - 1,
  }));
}

/** Avance dentro del tramo entre el rango actual y el siguiente, de 0 a 1. */
function tierProgress(
  points: number,
  current: LevelView | null,
  next: LevelView | null,
): number {
  if (!next) return 1;
  const floor = current?.minPoints ?? 0;
  const span = next.minPoints - floor;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - floor) / span));
}

function toBadgeView(
  badge: ProgressionBadgeModel,
  metrics: TrainingMetrics,
  earnedByBadgeId: ReadonlyMap<string, UserBadgeModel>,
  newlyEarnedIds: ReadonlySet<string>,
  chains: ReadonlyMap<string, { chain: string; chainStep: number; chainLength: number }>,
): BadgeView {
  const award = earnedByBadgeId.get(badge.id);
  const isNewAward = newlyEarnedIds.has(badge.id);
  const earned = Boolean(award) || isNewAward;
  const threshold = Number(badge.criterionThreshold);
  const value = measure(metrics, badge.criterionType);

  return {
    code: badge.code,
    name: badge.name,
    description: badge.description,
    flavorText: badge.flavorText,
    category: badge.category,
    rarity: badge.rarity,
    rarityRank: rarityRank(badge.rarity),
    icon: badge.icon,
    illustration: badgeIllustration(badge.code, badge.criterionType),
    color: badge.color,
    pointsReward: badge.pointsReward,
    secret: badge.secret,
    criterion: badge.criterionType,
    threshold,
    earned,
    earnedAt: award?.awardedAt.toISOString() ?? (isNewAward ? new Date().toISOString() : null),
    // Novedad = conseguida y todavía sin mostrar. Una insignia recién otorgada
    // en este recálculo aún no tiene fila `seen`, así que también lo es.
    isNew: isNewAward || (award !== undefined && !award.seen),
    progress: badge.secret && !earned ? null : Math.min(1, threshold <= 0 ? 1 : value / threshold),
    progressLabel:
      badge.secret && !earned
        ? null
        : `${formatMetric(value, badge.criterionType)} / ${formatMetric(threshold, badge.criterionType)}`,
    ...(chains.get(badge.code) ?? { chain: badge.criterionType, chainStep: 1, chainLength: 1 }),
  };
}

function formatMetric(value: number, criterion: BadgeCriterionType): string {
  const rounded = Math.floor(value);
  const formatted = rounded.toLocaleString("es-ES");
  switch (criterion) {
    case "TOTAL_VOLUME_KG":
    case "SINGLE_SESSION_VOLUME_KG":
    case "MAX_SET_WEIGHT_KG":
      return `${formatted} kg`;
    case "CARDIO_TOTAL_KM":
      // Un decimal: «42,2 km» no puede quedarse en «42».
      return `${(Math.floor(value * 10) / 10).toLocaleString("es-ES")} km`;
    case "TOTAL_TRAINING_MINUTES":
    case "CARDIO_TOTAL_MINUTES":
    case "LONGEST_SESSION_MINUTES":
      return rounded >= 120 ? `${Math.floor(rounded / 60).toLocaleString("es-ES")} h` : `${formatted} min`;
    case "TIMED_SECONDS_TOTAL":
      return rounded >= 120 ? `${Math.floor(rounded / 60).toLocaleString("es-ES")} min` : `${formatted} s`;
    default:
      return formatted;
  }
}

/** «Ana María Pérez Soto» → «Ana P.» */
function shortenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const surnameInitial = parts.length > 1 ? `${parts[1].charAt(0).toUpperCase()}.` : "";
  return [first, surnameInitial].filter(Boolean).join(" ");
}

function currentMonthString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/**
 * Strikes y penalizaciones a partir de las métricas (ver `streak-strikes.ts`).
 *
 * El saldo descuenta **todas** las penalizaciones y **todos** los strikes
 * comprados de la historia. Antes solo se descontaban los del mes en curso: al
 * cambiar de mes, los puntos gastados volvían solos.
 */
function strikeStateOf(metrics: TrainingMetrics, month: string) {
  const settlement = metrics.strikeSettlement;
  const usedThisMonth = settlement?.usedByMonth[month] ?? 0;
  const purchasedThisMonth = metrics.strikesPurchasedByMonth?.[month] ?? 0;
  const penalizedCount = Object.values(settlement?.penalizedByMonth ?? {}).reduce((total, count) => total + count, 0);
  return {
    ledger: {
      penaltyPoints: penalizedCount * MISSED_SESSION_PENALTY,
      purchasedStrikes: metrics.strikesPurchasedTotal ?? 0,
    },
    view: {
      totalMonthly: MONTHLY_STRIKES_BASE,
      available: Math.max(0, MONTHLY_STRIKES_BASE + purchasedThisMonth - usedThisMonth),
      usedThisMonth,
      purchasedThisMonth,
      strikeCostPoints: STRIKE_POINT_COST,
      month,
      /** Faltas de esta semana que aún se pueden reponer entrenando un día de descanso. */
      pendingThisWeek: settlement?.pendingThisWeek ?? 0,
      /** Puntos perdidos por faltas sin strike, en toda la historia. */
      penaltyPointsTotal: penalizedCount * MISSED_SESSION_PENALTY,
    },
  };
}
