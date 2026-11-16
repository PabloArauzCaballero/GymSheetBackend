import { Injectable } from "@nestjs/common";
import { isPendingReviewSuspension, PublicSanctionReason } from "../../common/moderation/account-suspension";
import { REASON_NOTICE } from "../moderation/moderation-notices";
import { ModerationReason, ModerationReasonValue } from "../moderation/moderation.policy";
import { SanctionStatusRepository } from "./sanction-status.repository";

/**
 * The public reason of the sanction an account is under, for the refusals at
 * login and on every request: the person must learn why without reading the
 * in-app inbox, which a suspended or banned account cannot open.
 */
@Injectable()
export class SanctionStatusService {
  constructor(private readonly repository: SanctionStatusRepository) {}

  /** The open-ended suspension is only ever the provisional one of a minor report. */
  async suspensionReason(userId: string, until: Date): Promise<PublicSanctionReason> {
    if (isPendingReviewSuspension(until)) return publicSanctionReason(ModerationReason.MENOR_DE_EDAD);
    return publicSanctionReason(await this.repository.runningSuspensionReason(userId, new Date()));
  }

  /** Null when the account is not banned (another kind of inactive account, or a closed one). */
  async banReason(userId: string): Promise<PublicSanctionReason | null> {
    const reason = await this.repository.banReason(userId);
    return reason === null ? null : publicSanctionReason(reason);
  }
}

/** Code, category label and text of a reason; an unknown or missing code reads as OTRO. */
export function publicSanctionReason(code: string | null): PublicSanctionReason {
  const known: ModerationReasonValue = code !== null && isModerationReason(code) ? code : ModerationReason.OTRO;
  const notice = REASON_NOTICE[known];
  return { code: known, label: notice.label, text: notice.text };
}

function isModerationReason(code: string): code is ModerationReasonValue {
  return Object.prototype.hasOwnProperty.call(REASON_NOTICE, code);
}
