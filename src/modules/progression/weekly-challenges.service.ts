import { Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { ChallengeTotals, ChallengesRepository } from "./challenges.repository";
import { businessToday } from "./progression.repository";
import {
  CHALLENGE_HISTORY_WEEKS,
  EMPTY_WEEK,
  PERFECT_WEEK_BONUS,
  StoredChallenge,
  WeekMeasures,
  WeeklyChallengesView,
  addDaysTo,
  generateWeeklyChallenges,
  mondayOfDate,
  toChallengeView,
  toWeeklyView,
  zonedMidnightIso,
} from "./weekly-challenges";

export interface ChallengesState {
  view: WeeklyChallengesView;
  totals: ChallengeTotals;
}

/**
 * Orquesta los retos de la semana: generar, guardar, medir y cerrar.
 *
 * Dos caminos con la misma cuenta, como el resto de la senda: `sync` escribe
 * (lo usa `getProgression`) y `preview` no (lo usa la foto previa a cerrar una
 * sesión). Si la foto escribiera, un reto cumplido antes de la sesión se
 * contaría como fruto de ella.
 */
@Injectable()
export class WeeklyChallengesService {
  constructor(private readonly repository: ChallengesRepository) {}

  async sync(userId: string): Promise<ChallengesState> {
    const { weekStart, endsAt } = currentWeek();
    const previousWeek = addDaysTo(weekStart, -7);
    const measures = await this.measure(userId, weekStart);

    let stored = await this.repository.listWeek(userId, weekStart);
    if (stored.length === 0) {
      await this.repository.insertWeek(userId, weekStart, this.generate(userId, weekStart, measures));
      stored = await this.repository.listWeek(userId, weekStart);
    }
    const current = measures.get(weekStart) ?? EMPTY_WEEK;
    const completedNow = newlyCompleted(stored, current);
    await this.repository.markCompleted(userId, weekStart, completedNow);

    // La semana pasada se revisa una vez más si quedó algo abierto: una sesión
    // del domingo por la noche que se sincroniza el lunes tiene que contar
    // para la semana en que se entrenó, no perderse en el cambio de semana.
    if ((await this.repository.latestOpenWeekBefore(userId, weekStart)) === previousWeek) {
      const previous = await this.repository.listWeek(userId, previousWeek);
      await this.repository.markCompleted(
        userId,
        previousWeek,
        newlyCompleted(previous, measures.get(previousWeek) ?? EMPTY_WEEK),
      );
    }

    if (completedNow.length > 0) stored = await this.repository.listWeek(userId, weekStart);
    return {
      view: toWeeklyView({ weekStart, endsAt, items: stored.map((c) => toChallengeView(c, current[c.kind])) }),
      totals: await this.repository.totals(userId),
    };
  }

  /** Igual que `sync` pero sin escribir: lo que se cumpliría ahora se suma en memoria. */
  async preview(userId: string): Promise<ChallengesState> {
    const { weekStart, endsAt } = currentWeek();
    const measures = await this.measure(userId, weekStart);
    const stored = await this.repository.listWeek(userId, weekStart);
    const challenges: StoredChallenge[] =
      stored.length > 0
        ? stored
        : this.generate(userId, weekStart, measures).map((spec) => ({ ...spec, completedAt: null, seen: false }));
    const current = measures.get(weekStart) ?? EMPTY_WEEK;
    const view = toWeeklyView({
      weekStart,
      endsAt,
      items: challenges.map((c) => toChallengeView(c, current[c.kind])),
    });

    const totals = await this.repository.totals(userId);
    const pending = challenges.filter((c) => c.completedAt === null && current[c.kind] >= c.target);
    const wasPerfect = totals.perfectWeekStarts.includes(weekStart);
    const becomesPerfect = view.perfect && !wasPerfect;
    return {
      view,
      totals: {
        completed: totals.completed + pending.length,
        perfectWeeks: totals.perfectWeeks + (becomesPerfect ? 1 : 0),
        points:
          totals.points +
          pending.reduce((sum, c) => sum + c.pointsReward, 0) +
          (becomesPerfect ? PERFECT_WEEK_BONUS : 0),
        perfectWeekStarts: becomesPerfect ? [...totals.perfectWeekStarts, weekStart] : totals.perfectWeekStarts,
      },
    };
  }

  acknowledge(userId: string): Promise<void> {
    return this.repository.markSeen(userId);
  }

  /** Las cuatro semanas de historial más la actual, en una sola consulta. */
  private measure(userId: string, weekStart: string): Promise<Map<string, WeekMeasures>> {
    return this.repository.measureWeeks(
      userId,
      addDaysTo(weekStart, -7 * CHALLENGE_HISTORY_WEEKS),
      weekStart,
      env.BUSINESS_TIME_ZONE,
    );
  }

  private generate(userId: string, weekStart: string, measures: ReadonlyMap<string, WeekMeasures>) {
    const history = Array.from(
      { length: CHALLENGE_HISTORY_WEEKS },
      (_, index) => measures.get(addDaysTo(weekStart, -7 * (index + 1))) ?? EMPTY_WEEK,
    );
    return generateWeeklyChallenges({ userId, weekStart, history });
  }
}

function newlyCompleted(challenges: readonly StoredChallenge[], measured: WeekMeasures): string[] {
  return challenges
    .filter((c) => c.completedAt === null && measured[c.kind] >= c.target)
    .map((c) => c.code);
}

/** La semana en curso en la zona del negocio: su lunes y el instante en que acaba. */
export function currentWeek(today: string = businessToday(env.BUSINESS_TIME_ZONE)): {
  weekStart: string;
  endsAt: string;
} {
  const weekStart = mondayOfDate(today);
  return { weekStart, endsAt: zonedMidnightIso(addDaysTo(weekStart, 7), env.BUSINESS_TIME_ZONE) };
}
