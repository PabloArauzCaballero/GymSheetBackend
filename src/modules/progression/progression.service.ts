import { Injectable, NotFoundException } from "@nestjs/common";
import { UserGender } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import { ProgressionBadgeModel } from "./progression-badge.model";
import { ProgressionLevelModel } from "./progression-level.model";
import { ProgressionRepository, TrainingMetrics } from "./progression.repository";
import type { BadgeCriterionType, ProgressionAudience } from "./progression-catalog";
import { UserBadgeModel } from "./user-badge.model";

/**
 * Cuánto vale cada cosa.
 *
 * La escala se eligió para que una sesión normal —unas veinte series y cinco
 * toneladas— ronde los 150 puntos, que es la unidad con la que están calibrados
 * los umbrales de los rangos. Cambiar estos números sin mover los umbrales
 * recoloca a todo el gimnasio de golpe, así que van juntos.
 */
const POINTS = {
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
} as const;

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
  icon: string;
  color: string;
  pointsReward: number;
  earned: boolean;
  earnedAt: string | null;
  /** Novedad desde la última vez que se abrió la pantalla. */
  isNew: boolean;
  /** Progreso hacia el umbral, de 0 a 1. Nulo en las secretas no conseguidas. */
  progress: number | null;
  progressLabel: string | null;
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
}

@Injectable()
export class ProgressionService {
  constructor(
    private readonly progressionRepository: ProgressionRepository,
    private readonly usersRepository: UsersRepository,
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

    const points = computePoints(metrics, satisfied);
    const path = buildPath(levels, points);
    // El rango vigente es el último desbloqueado. Se busca por índice y no con
    // `findLast` porque la librería de destino de este proyecto no lo incluye.
    const current = path.filter((level) => level.unlocked).at(-1) ?? null;
    const next = path.find((level) => !level.unlocked) ?? null;

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

    const newlyEarnedIds = new Set(newlyEarned.map((badge) => badge.id));
    const badgeViews = badges.map((badge) =>
      toBadgeView(badge, metrics, earnedByBadgeId, newlyEarnedIds),
    );

    return {
      points,
      audience,
      level: current,
      nextLevel: next,
      pointsToNextLevel: next ? Math.max(0, next.minPoints - points) : null,
      levelProgress: tierProgress(points, current, next),
      path,
      // Las secretas no conseguidas no se listan: anunciarlas las convertiría en
      // una lista de tareas y perderían lo único que aportan, la sorpresa.
      badges: badgeViews.filter((view) => view.earned || !isSecret(badges, view.code)),
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
    };
  }

  /** Marca como vistas las novedades, para que dejen de celebrarse. */
  async acknowledge(userId: string): Promise<{ acknowledged: true }> {
    await this.progressionRepository.markBadgesSeen(userId);
    return { acknowledged: true };
  }

  async getLeaderboard(userId: string, limit: number) {
    const user = await this.usersRepository.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado.");
    const tenantId = user.tenantId ?? env.DEFAULT_TENANT_ID ?? null;
    const rows = await this.progressionRepository.leaderboard(tenantId, limit);
    return rows.map((row, index) => ({
      position: index + 1,
      points: Number(row.points),
      levelCode: row.levelCode,
      // Solo el nombre de pila y la inicial: una tabla pública con el nombre
      // completo de cada socio es una lista de clientes del gimnasio.
      displayName: shortenName(row.fullName),
      isMe: row.userId === userId,
    }));
  }
}

function isSecret(badges: readonly ProgressionBadgeModel[], code: string): boolean {
  return badges.find((badge) => badge.code === code)?.secret ?? false;
}

function idOf(badges: readonly ProgressionBadgeModel[], code: string): string {
  return badges.find((badge) => badge.code === code)?.id ?? "";
}

export function toAudience(gender: UserGender | null): ProgressionAudience {
  if (gender === UserGender.MALE) return "MALE";
  if (gender === UserGender.FEMALE) return "FEMALE";
  return "ANY";
}

export function computePoints(
  metrics: TrainingMetrics,
  earnedBadges: readonly { pointsReward: number }[],
): number {
  const badgePoints = earnedBadges.reduce((total, badge) => total + badge.pointsReward, 0);
  return (
    metrics.totalSessions * POINTS.perSession +
    metrics.totalSets * POINTS.perSet +
    Math.floor(metrics.totalVolumeKg / POINTS.perVolumeUnitKg) +
    metrics.longestStreakDays * POINTS.perLongestStreakDay +
    badgePoints
  );
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
    icon: badge.icon,
    color: badge.color,
    pointsReward: badge.pointsReward,
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
  };
}

function formatMetric(value: number, criterion: BadgeCriterionType): string {
  const isKilograms =
    criterion === "TOTAL_VOLUME_KG" || criterion === "SINGLE_SESSION_VOLUME_KG";
  const rounded = Math.floor(value);
  const formatted = rounded.toLocaleString("es-ES");
  return isKilograms ? `${formatted} kg` : formatted;
}

/** «Ana María Pérez Soto» → «Ana P.» */
function shortenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const surnameInitial = parts.length > 1 ? `${parts[1].charAt(0).toUpperCase()}.` : "";
  return [first, surnameInitial].filter(Boolean).join(" ");
}
