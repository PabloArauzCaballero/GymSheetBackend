import { Injectable } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import type { TutorialProgressUpsertInput } from "./tutorial-progress.schemas";

type ProgressRow = {
  tutorial_id: string;
  status: string;
  version: string;
  current_step_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  last_interaction_at: Date;
  repeat_count: number;
};

/** La forma `TutorialProgressRecord` de `@gymsheet/types`. */
export type TutorialProgressRecord = {
  tutorialId: string;
  status: string;
  version: string;
  currentStepId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastInteractionAt: string;
  repeatCount: number;
};

const COLUMNS = `tutorial_id, status, version, current_step_id, started_at, completed_at,
  last_interaction_at, repeat_count`;

function toRecord(row: ProgressRow): TutorialProgressRecord {
  return {
    tutorialId: row.tutorial_id,
    status: row.status,
    version: row.version,
    currentStepId: row.current_step_id,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    lastInteractionAt: new Date(row.last_interaction_at).toISOString(),
    repeatCount: Number(row.repeat_count),
  };
}

/**
 * Progreso de las guías por persona. Solo toca filas de quien llama (el id
 * sale del token, nunca del cuerpo), así que no hay forma de leer ni escribir
 * el progreso de otra cuenta.
 */
@Injectable()
export class TutorialProgressService {
  constructor(private readonly sequelize: Sequelize) {}

  async list(userId: string): Promise<TutorialProgressRecord[]> {
    const rows = await this.sequelize.query<ProgressRow>(
      `SELECT ${COLUMNS} FROM profile.tutorial_progress WHERE user_id = :userId ORDER BY tutorial_id`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return rows.map(toRecord);
  }

  /**
   * Idempotente: la misma petición dos veces deja la misma fila. Lo que el
   * cuerpo no trae se conserva (un «Omitir» no borra la fecha de inicio).
   */
  async upsert(userId: string, tutorialId: string, input: TutorialProgressUpsertInput): Promise<TutorialProgressRecord> {
    const rows = await this.sequelize.query<ProgressRow>(
      `INSERT INTO profile.tutorial_progress
         (user_id, tutorial_id, status, version, current_step_id, started_at, completed_at, last_interaction_at, repeat_count)
       VALUES (:userId, :tutorialId, :status, :version, :currentStepId, :startedAt, :completedAt, now(), :repeatCount)
       ON CONFLICT (user_id, tutorial_id) DO UPDATE SET
         status = EXCLUDED.status,
         version = EXCLUDED.version,
         current_step_id = CASE WHEN :hasCurrentStep THEN EXCLUDED.current_step_id ELSE profile.tutorial_progress.current_step_id END,
         started_at = COALESCE(EXCLUDED.started_at, profile.tutorial_progress.started_at),
         completed_at = CASE WHEN :hasCompletedAt THEN EXCLUDED.completed_at ELSE profile.tutorial_progress.completed_at END,
         last_interaction_at = now(),
         repeat_count = CASE WHEN :hasRepeatCount THEN EXCLUDED.repeat_count ELSE profile.tutorial_progress.repeat_count END
       RETURNING ${COLUMNS}`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId,
          tutorialId,
          status: input.status,
          version: input.version,
          currentStepId: input.currentStepId ?? null,
          startedAt: input.startedAt ?? null,
          completedAt: input.completedAt ?? null,
          repeatCount: input.repeatCount ?? 0,
          hasCurrentStep: input.currentStepId !== undefined,
          hasCompletedAt: input.completedAt !== undefined,
          hasRepeatCount: input.repeatCount !== undefined,
        },
      },
    );
    return toRecord(rows[0]);
  }

  /** Vuelve a «sin empezar»: borra la fila y devuelve lo que queda. */
  async reset(userId: string, tutorialId: string): Promise<TutorialProgressRecord[]> {
    await this.sequelize.query(
      `DELETE FROM profile.tutorial_progress WHERE user_id = :userId AND tutorial_id = :tutorialId`,
      { replacements: { userId, tutorialId } },
    );
    return this.list(userId);
  }
}
