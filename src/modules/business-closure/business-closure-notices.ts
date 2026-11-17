import { Injectable, Logger } from "@nestjs/common";
import { Transaction } from "sequelize";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { NotificationService } from "../notifications/notification.service";

/** Who is told what when a business closes (plan §2.12). The texts name the business, never another person. */
export type ClosureNotice =
  | { kind: "AFFILIATION_ENDED"; affiliationId: string; businessName: string; role: "SOCIO" | "ENTRENADOR" }
  | { kind: "COACH_LINK_ENDED"; affiliationId: string; businessName: string }
  | { kind: "PERIOD_CANCELLED"; membershipId: string; businessName: string; planName: string };

function render(notice: ClosureNotice): { subject: string; body: string; key: string; metadata: Record<string, unknown> } {
  switch (notice.kind) {
    case "AFFILIATION_ENDED":
      return {
        subject: `Afiliación terminada · ${notice.businessName}`,
        body: `${notice.businessName} cerró su cuenta en REPP, así que tu afiliación como ${notice.role === "SOCIO" ? "socio" : "entrenador"} terminó.`,
        key: `affiliation:${notice.affiliationId}:business-closed`,
        metadata: { kind: "AFFILIATION", event: "ENDED", reasonCode: "BUSINESS_CLOSED", affiliationId: notice.affiliationId },
      };
    case "COACH_LINK_ENDED":
      return {
        subject: `Coach desvinculado · ${notice.businessName}`,
        body: `${notice.businessName} cerró su cuenta en REPP y ya no figura como entrenador de tu gimnasio.`,
        key: `affiliation:${notice.affiliationId}:business-closed`,
        metadata: { kind: "AFFILIATION", event: "ENDED", reasonCode: "BUSINESS_CLOSED", affiliationId: notice.affiliationId },
      };
    case "PERIOD_CANCELLED":
      return {
        subject: `Suscripción cancelada · ${notice.businessName}`,
        body: `${notice.businessName} cerró su cuenta en REPP y tu «${notice.planName}» quedó cancelada. REPP no cobra ni devuelve pagos: si te corresponde una devolución, es con el negocio.`,
        key: `subscription:${notice.membershipId}:business-closed`,
        metadata: { kind: "SUBSCRIPTION", event: "CANCELLED", reasonCode: "BUSINESS_CLOSED", membershipId: notice.membershipId },
      };
  }
}

/** In-app notices of a business closure. A notice that fails never undoes the closure. */
@Injectable()
export class BusinessClosureNotices {
  private readonly logger = new Logger(BusinessClosureNotices.name);

  constructor(private readonly notifications: NotificationService) {}

  async send(recipientUserId: string | null, notice: ClosureNotice, transaction: Transaction): Promise<void> {
    if (!recipientUserId) return;
    const { subject, body, key, metadata } = render(notice);
    try {
      // Its own savepoint (inside the service): a failure rolls back the notice only.
      await this.notifications.enqueueDirectMessage(
        { recipientUserId, channel: NotificationChannel.IN_APP, subject, body, deduplicationKey: key, metadata },
        transaction,
      );
    } catch (error: unknown) {
      this.logger.warn({ event: "business_closure.notice_failed", notice: notice.kind, errorName: error instanceof Error ? error.name : "UnknownError" });
    }
  }
}
