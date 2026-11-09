import { Injectable } from "@nestjs/common";
import { TutorialProgressModel } from "./tutorial-progress.model";
import { TutorialProgressRepository } from "./tutorial-progress.repository";
import {
  TutorialProgressRecordDto,
  TutorialProgressStatus,
  TutorialProgressUpsertInput,
} from "./tutorial-progress.schemas";

export function toRecordDto(row: TutorialProgressModel): TutorialProgressRecordDto {
  return {
    tutorialId: row.tutorialId,
    status: row.status as TutorialProgressStatus,
    version: row.version,
    currentStepId: row.currentStepId ?? null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    lastInteractionAt: row.lastInteractionAt.toISOString(),
    repeatCount: row.repeatCount ?? 0,
  };
}

@Injectable()
export class TutorialProgressService {
  constructor(private readonly repository: TutorialProgressRepository) {}

  async list(userId: string): Promise<TutorialProgressRecordDto[]> {
    return (await this.repository.listByUser(userId)).map(toRecordDto);
  }

  /**
   * PUT idempotente. Un campo ausente conserva lo guardado y `null` lo borra;
   * así reenviar la misma petición, o una parcial, nunca pierde datos.
   */
  async upsert(
    userId: string,
    tutorialId: string,
    input: TutorialProgressUpsertInput,
    now: Date = new Date(),
  ): Promise<TutorialProgressRecordDto> {
    const existing = await this.repository.findOne(userId, tutorialId);
    const saved = await this.repository.upsert(
      userId,
      tutorialId,
      {
        status: input.status,
        version: input.version,
        currentStepId:
          input.currentStepId === undefined ? (existing?.currentStepId ?? null) : input.currentStepId,
        startedAt:
          input.startedAt === undefined
            ? (existing?.startedAt ?? null)
            : input.startedAt === null
              ? null
              : new Date(input.startedAt),
        completedAt:
          input.completedAt === undefined
            ? (existing?.completedAt ?? null)
            : input.completedAt === null
              ? null
              : new Date(input.completedAt),
        repeatCount: input.repeatCount ?? existing?.repeatCount ?? 0,
      },
      now,
    );
    return toRecordDto(saved);
  }

  /** Reinicia un tutorial (borra su registro) y devuelve la lista que queda. */
  async reset(userId: string, tutorialId: string): Promise<TutorialProgressRecordDto[]> {
    await this.repository.remove(userId, tutorialId);
    return this.list(userId);
  }
}
