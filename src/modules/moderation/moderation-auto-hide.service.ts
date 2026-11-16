import { Injectable, Logger } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { NotificationService } from "../notifications/notification.service";
import { contentHiddenNotice, contentRestoredNotice, ModerationNotice, sendModerationNotice } from "./moderation-notices";
import { ModerationSafeguardsRepository } from "./moderation-safeguards.repository";
import { ModerationRepository } from "./moderation.repository";
import {
  AUTO_HIDE_DISTINCT_REPORTERS,
  isHideableTarget,
  ModerationReasonValue,
  ModerationTargetKindValue,
} from "./moderation.policy";

type Target = { kind: ModerationTargetKindValue; id: string };

/**
 * Automatic curtain after enough distinct reporters (patrón de Tinder/Facebook).
 *
 * Hiding without a person deciding is only acceptable if a person then looks
 * and the author knows: the hide opens a review item in the moderation queue
 * and tells the author, with the reason category, that the content is hidden
 * pending review. The moderator's decision closes the item and either keeps
 * the content hidden or restores it (and tells the author).
 */
@Injectable()
export class ModerationAutoHideService {
  private readonly logger = new Logger(ModerationAutoHideService.name);

  constructor(
    private readonly sequelize: Sequelize,
    private readonly repository: ModerationRepository,
    private readonly safeguards: ModerationSafeguardsRepository,
    private readonly notifications: NotificationService,
  ) {}

  async hideIfThresholdReached(
    target: Target,
    owner: { userId: string; tenantId: string },
    reason: ModerationReasonValue,
  ): Promise<boolean> {
    if (!isHideableTarget(target.kind)) return false;

    const reporters = await this.repository.countDistinctReporters(target.kind, target.id);
    if (reporters < AUTO_HIDE_DISTINCT_REPORTERS) return false;

    await this.sequelize.transaction(async (transaction) => {
      await this.repository.setContentHidden(
        {
          targetKind: target.kind,
          targetId: target.id,
          hidden: true,
          // Lo oculta el sistema, no una persona: se deja SIN moderador. Un
          // identificador inventado violaría la clave foránea contra
          // `usuarios`, y uno real atribuiría a alguien una decisión que no
          // tomó.
          moderatorUserId: null,
          reason,
        },
        transaction,
      );
      const reviewId = await this.safeguards.openAutoHideReview(
        {
          tenantId: owner.tenantId,
          targetKind: target.kind,
          targetId: target.id,
          authorUserId: owner.userId,
          reason,
          distinctReporters: reporters,
        },
        transaction,
      );
      // A fourth reporter finds the item open: the author was already told.
      if (reviewId) {
        await sendModerationNotice(this.notifications, owner.userId, contentHiddenNotice(reason, target, true), `moderation.auto-hidden:${reviewId}`, transaction);
      }
    });
    this.logger.log(
      { event: "moderation.auto_hidden", targetKind: target.kind, targetId: target.id, reporters },
      ModerationAutoHideService.name,
    );
    return true;
  }

  /**
   * Inside the resolve transaction: closes the review item, if any, and returns
   * the notice the author gets after commit (moderator hid the content, or
   * restored what the threshold hid). A sanction notice already covers a
   * sanctioned author.
   */
  async closeReview(
    target: Target,
    input: { moderatorUserId: string; hidden: boolean; sanctioned: boolean; reason: ModerationReasonValue },
    transaction: Transaction,
  ): Promise<ModerationNotice | null> {
    if (!isHideableTarget(target.kind)) return null;
    const wasAutoHidden = await this.safeguards.closeAutoHideReview(target, input.moderatorUserId, !input.hidden, transaction);
    if (input.sanctioned) return null;
    if (input.hidden) return contentHiddenNotice(input.reason, target, false);
    return wasAutoHidden ? contentRestoredNotice(target) : null;
  }
}
