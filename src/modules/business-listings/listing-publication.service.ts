import { Injectable } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { env } from '../../config/env';
import type { EntityPlanModel, ListingModerationStatus, ListingOfferKind } from '../directory/models/entity-plan.model';
import { BusinessListingsRepository } from './business-listings.repository';
import { PublicationCheckCode, moderationAfterChecks, priceCheckCodes } from './listing-checks';

/** Which families of fields changed: only those are re-checked on a published listing. */
export type CheckScope = { text: boolean; price: boolean };

export type PublicationOutcome = {
  moderationStatus: ListingModerationStatus;
  moderationReasonCode: string | null;
  autoCheckCodes: string[];
  publishedAt: Date | null;
};

type Candidate = { entityId: string; offerKind: ListingOfferKind; name: string; description: string; benefits: string[]; price: number };

/**
 * Post-moderation (ADR-0022): a listing goes LIVE the moment the automatic
 * checks pass; any failure holds it (HELD, not public) for REPP with the codes
 * the seller can read. On a LIVE listing only the edited family is re-checked,
 * so a price REPP already released is not held again by a text edit; a HELD
 * listing re-runs everything (that is how the seller fixes it).
 */
@Injectable()
export class ListingPublicationService {
  constructor(private readonly repository: BusinessListingsRepository) {}

  async evaluate(
    candidate: Candidate,
    current: EntityPlanModel | null,
    scope: CheckScope,
    transaction: Transaction,
  ): Promise<PublicationOutcome> {
    const checkAll = !current || current.moderationStatus === 'HELD';
    const codes: PublicationCheckCode[] = [];
    if (checkAll || scope.price) {
      const median = await this.repository.priceMedian(candidate.offerKind, candidate.entityId, env.LISTING_PRICE_MEDIAN_MIN_SELLERS, transaction);
      codes.push(
        ...priceCheckCodes(
          candidate.price,
          { min: env.LISTING_PRICE_MIN_BOB, max: env.LISTING_PRICE_MAX_BOB, outlierFactor: env.LISTING_PRICE_OUTLIER_FACTOR },
          median,
        ),
      );
    }
    if ((checkAll || scope.text) && (await this.repository.containsBannedTerm([candidate.name, candidate.description, ...candidate.benefits], transaction))) {
      codes.push('BANNED_TERMS');
    }
    const status = moderationAfterChecks(current?.moderationStatus ?? null, codes);
    // The codes of this run are always stored: they are what an un-hide reads (ADR-0022 §3).
    // A REPP decision (HIDDEN, REJECTED) keeps REPP's reason; the checks' first code otherwise.
    const repp = status === 'HIDDEN' || status === 'REJECTED';
    return {
      moderationStatus: status,
      moderationReasonCode: repp && current ? current.moderationReasonCode : (codes[0] ?? null),
      autoCheckCodes: codes,
      publishedAt: status === 'LIVE' ? (current?.publishedAt ?? new Date()) : (current?.publishedAt ?? null),
    };
  }
}
