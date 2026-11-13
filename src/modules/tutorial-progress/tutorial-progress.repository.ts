import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { TutorialProgressModel } from "./tutorial-progress.model";

export interface TutorialProgressValues {
  status: string;
  version: string;
  currentStepId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  repeatCount: number;
}

@Injectable()
export class TutorialProgressRepository {
  constructor(
    @InjectModel(TutorialProgressModel) private readonly progress: typeof TutorialProgressModel,
  ) {}

  /** Todo es del propio usuario: el `userId` sale del JWT y filtra siempre. */
  listByUser(userId: string): Promise<TutorialProgressModel[]> {
    return this.progress.findAll({ where: { userId }, order: [["tutorialId", "ASC"]] });
  }

  findOne(userId: string, tutorialId: string): Promise<TutorialProgressModel | null> {
    return this.progress.findOne({ where: { userId, tutorialId } });
  }

  /** Idempotente: la misma petición dos veces deja el mismo registro. */
  async upsert(
    userId: string,
    tutorialId: string,
    values: TutorialProgressValues,
    now: Date,
  ): Promise<TutorialProgressModel> {
    await this.progress.upsert({ userId, tutorialId, ...values, lastInteractionAt: now });
    const saved = await this.findOne(userId, tutorialId);
    if (!saved) throw new Error("tutorial_progress no encontrado tras el upsert");
    return saved;
  }

  async remove(userId: string, tutorialId: string): Promise<void> {
    await this.progress.destroy({ where: { userId, tutorialId } });
  }
}
