import { Injectable } from "@nestjs/common";
import { InjectConnection, InjectModel } from "@nestjs/sequelize";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ReelModel } from "./reel.model";

@Injectable()
export class ReelsRepository {
  constructor(
    @InjectModel(ReelModel) private readonly reels: typeof ReelModel,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  create(input: {
    userId: string;
    tenantId: string;
    storageProvider: ReelModel["storageProvider"];
    storageKey: string;
    mimeType: ReelModel["mimeType"];
    durationSeconds: string;
  }): Promise<ReelModel> {
    return this.reels.create({ ...input, status: "READY" });
  }

  async beginIdempotentProcessing(input: {
    userId: string;
    tenantId: string;
    storageProvider: ReelModel["storageProvider"];
    mimeType: ReelModel["mimeType"];
    durationSeconds: string;
    requestId: string;
    contentSha256: string;
  }): Promise<ReelModel> {
    return this.sequelize.transaction(async (transaction: Transaction) => {
      const existing = await this.reels.findOne({
        where: { userId: input.userId, processingRequestId: input.requestId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing) {
        if (existing.processingContentSha256 !== input.contentSha256) {
          return existing;
        }
        if (existing.status === "READY") return existing;
        await existing.update(
          {
            status: "PROCESSING",
            processingAttemptCount: existing.processingAttemptCount + 1,
          },
          { transaction },
        );
        return existing;
      }

      return this.reels.create(
        {
          userId: input.userId,
          tenantId: input.tenantId,
          storageProvider: input.storageProvider,
          storageKey: `pending/${input.userId}/reels/${input.requestId}`,
          mimeType: input.mimeType,
          durationSeconds: input.durationSeconds,
          processingRequestId: input.requestId,
          processingContentSha256: input.contentSha256,
          processingAttemptCount: 1,
          status: "PROCESSING",
        },
        { transaction },
      );
    });
  }

  async markProcessingFailed(reelId: string): Promise<void> {
    await this.reels.update(
      { status: "FAILED" },
      { where: { id: reelId, status: "PROCESSING" } },
    );
  }

  async markProcessingReady(
    reelId: string,
    stored: {
      provider: ReelModel["storageProvider"];
      key: string;
      mimeType: ReelModel["mimeType"];
      durationSeconds: string;
    },
  ): Promise<ReelModel> {
    const reel = await this.reels.findByPk(reelId);
    if (!reel) throw new Error("Reel processing row disappeared.");
    await reel.update({
      storageProvider: stored.provider,
      storageKey: stored.key,
      mimeType: stored.mimeType,
      durationSeconds: stored.durationSeconds,
      status: "READY",
    });
    return reel;
  }

  feedForOwner(userId: string): Promise<ReelModel[]> {
    return this.reels.findAll({
      where: { userId, status: "READY", hiddenAt: null, deletedAt: null },
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
      limit: 50,
    });
  }

  findReadyForOwner(reelId: string, userId: string): Promise<ReelModel | null> {
    return this.reels.findOne({
      where: {
        id: reelId,
        userId,
        status: "READY",
        hiddenAt: null,
        deletedAt: null,
      },
    });
  }

  findReady(reelId: string): Promise<ReelModel | null> {
    return this.reels.findOne({
      where: {
        id: reelId,
        status: "READY",
        hiddenAt: null,
        deletedAt: null,
      },
    });
  }
}
