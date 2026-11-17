import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Transaction } from "sequelize";
import { MembershipStatus } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import { ownBusinessMediaKey } from "../business-accounts/business-accounts.service";
import { OrderLifecycle } from "../business-orders/order-lifecycle.service";
import { OrderNotices, orderRef } from "../business-orders/order-notices";
import { OrdersRepository } from "../business-orders/orders.repository";
import type { BusinessSanctionTrace } from "../closed-account-sanctions/closed-account-sanctions.service";
import { GymDomainEvent } from "../integration/domain-event.catalog";
import { DomainEventPublisher } from "../integration/domain-event.publisher";
import { BusinessClosureNotices } from "./business-closure-notices";
import { BusinessClosureRepository, ClosingBusiness } from "./business-closure.repository";

export type PreparedBusinessClosure = {
  /** Storage keys of the public logo, cover, gallery and listing photos, released after the catalogue runs. */
  mediaKeys: string[];
  /** What the closed-account sanction keeps of this business (ADR-0028). */
  sanction: BusinessSanctionTrace;
};

export function pendingVerificationsError(count: number): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    "BUSINESS_HAS_PENDING_VERIFICATIONS",
    "Tienes comprobantes de pago por revisar. Confírmalos o recházalos antes de cerrar tu negocio.",
    { count, action: "GET /business/me/orders?status=PENDING_VERIFICATION" },
  );
}

/**
 * The business part of closing a business account (plan §2.14, ADR-0028),
 * inside the closure transaction and before the catalogue runs. It refuses
 * while a receipt waits for the business (money may have moved), then
 * cancels the unpaid orders, ends the affiliations and cancels the running
 * or upcoming periods, each with its history and a notice to the person.
 * The rest (listing, handle, listings, payment data, chats) is catalogue SQL.
 */
@Injectable()
export class BusinessClosureService {
  constructor(
    private readonly repository: BusinessClosureRepository,
    private readonly orders: OrdersRepository,
    private readonly lifecycle: OrderLifecycle,
    private readonly orderNotices: OrderNotices,
    private readonly notices: BusinessClosureNotices,
    private readonly events: DomainEventPublisher,
  ) {}

  /** For the preview: receipts that block the closure right now. */
  async blockers(userId: string): Promise<{ code: "BUSINESS_HAS_PENDING_VERIFICATIONS"; count: number }[]> {
    const count = await this.repository.lockOrdersAndCountWaitingReceipts(userId);
    return count > 0 ? [{ code: "BUSINESS_HAS_PENDING_VERIFICATIONS", count }] : [];
  }

  async prepare(userId: string, transaction: Transaction): Promise<PreparedBusinessClosure> {
    const business = await this.repository.lockAccount(userId, transaction);
    if (!business) throw new NotFoundException("Cuenta de negocio no encontrada.");
    const listings = await this.repository.lockListings(business.entityId, transaction);
    const waiting = await this.repository.lockOrdersAndCountWaitingReceipts(userId, transaction);
    if (waiting > 0) throw pendingVerificationsError(waiting);

    const hmacs = await this.repository.identityHmacs(userId, transaction);
    await this.cancelUnpaidOrders(userId, transaction);
    await this.endAffiliations(userId, business, transaction);
    await this.cancelPeriods(userId, business, transaction);
    return {
      mediaKeys: publicMediaKeys(business, listings),
      sanction: { nitHmacs: hmacs.nit, ciHmacs: hmacs.ci, suspended: business.status === "SUSPENDED" },
    };
  }

  private async cancelUnpaidOrders(userId: string, transaction: Transaction): Promise<void> {
    for (const id of await this.repository.effectIds("CANCEL_UNPAID_ORDERS", userId, transaction)) {
      const order = await this.orders.lockOrder(id, transaction);
      if (!order) continue;
      const now = new Date();
      await this.lifecycle.close(order, "CANCELLED", { actorUserId: null, reasonCode: "BUSINESS_CLOSED", patch: { cancelledAt: now, cancelReason: "BUSINESS_CLOSED" } }, transaction);
      await this.orderNotices.send(order.athleteUserId, orderRef(order), { kind: "BUSINESS_CLOSED" }, transaction);
    }
  }

  private async endAffiliations(userId: string, business: ClosingBusiness, transaction: Transaction): Promise<void> {
    for (const row of await this.repository.endAffiliations(userId, transaction)) {
      const notice = row.closingIsGym
        ? { kind: "AFFILIATION_ENDED" as const, affiliationId: row.id, businessName: business.name, role: row.kind }
        : { kind: "COACH_LINK_ENDED" as const, affiliationId: row.id, businessName: business.name };
      await this.notices.send(row.recipientUserId, notice, transaction);
    }
  }

  private async cancelPeriods(userId: string, business: ClosingBusiness, transaction: Transaction): Promise<void> {
    for (const period of await this.repository.cancelPeriods(userId, transaction)) {
      const event = await this.events.record(
        {
          eventName: GymDomainEvent.MEMBERSHIP_STATUS_CHANGED,
          aggregateType: "membership",
          aggregateId: period.id,
          deduplicationKey: `membership.status-changed:${period.id}:business-closed`,
          actorUserId: null,
          payload: {
            membershipId: period.id,
            userId: period.userId,
            fromStatus: period.fromStatus as MembershipStatus,
            toStatus: MembershipStatus.CANCELLED,
            reason: "BUSINESS_CLOSED",
          },
        },
        transaction,
      );
      await this.repository.recordPeriodHistory({ id: randomUUID(), membershipId: period.id, fromStatus: period.fromStatus, domainEventId: event.id }, transaction);
      await this.notices.send(
        period.userId,
        { kind: "PERIOD_CANCELLED", membershipId: period.id, businessName: business.name, planName: period.planName },
        transaction,
      );
    }
  }
}

/** Files of the public profile and of the listings, in the business's own public folder only. */
function publicMediaKeys(business: ClosingBusiness, listings: readonly { mediaUrls: string[] | null }[]): string[] {
  const urls = [business.logoUrl, business.coverUrl, ...(business.gallery ?? []), ...listings.flatMap((listing) => listing.mediaUrls ?? [])];
  const keys = urls.map((url) => ownBusinessMediaKey(url, business.entityId, env.MEDIA_STORAGE_PUBLIC_BASE_URL));
  return [...new Set(keys.filter((key): key is string => key !== null))];
}
