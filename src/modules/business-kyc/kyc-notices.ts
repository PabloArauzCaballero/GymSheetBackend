import { Injectable } from "@nestjs/common";
import { Transaction } from "sequelize";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { env } from "../../config/env";
import { NotificationService } from "../notifications/notification.service";
import { BUSINESS_SUSPENSION_REASONS, BusinessSuspensionReason, KYC_REJECTION_REASONS, KycRejectionReason } from "./kyc.catalog";

const dateFormat = new Intl.DateTimeFormat("es-BO", { dateStyle: "long", timeStyle: "short", timeZone: env.BUSINESS_TIME_ZONE });

export type KycNotice =
  | { kind: "AUTO_APPROVED"; handle: string }
  | { kind: "IN_REVIEW"; reviewDueAt: Date }
  | { kind: "APPROVED"; handle: string | null }
  | { kind: "REJECTED"; reasons: readonly KycRejectionReason[]; allowResubmit: boolean; materialChange: boolean }
  | { kind: "SUSPENDED"; reason: BusinessSuspensionReason }
  | { kind: "REINSTATED" };

function render(notice: KycNotice): { subject: string; body: string } {
  switch (notice.kind) {
    case "AUTO_APPROVED":
      return {
        subject: "Tu negocio ya está publicado",
        body: `¡Listo! Tu negocio ya está publicado en @${notice.handle}. REPP revisará tus datos en las próximas ${env.BUSINESS_KYC_POST_REVIEW_SLA_HOURS} horas; si falta algo te avisamos.`,
      };
    case "IN_REVIEW":
      return {
        subject: "Estamos revisando tu negocio",
        body: `El equipo de REPP está revisando tus datos. Te respondemos antes del ${dateFormat.format(notice.reviewDueAt)}.`,
      };
    case "APPROVED":
      return {
        subject: "Tu negocio está verificado por REPP",
        body: notice.handle
          ? `REPP revisó tus datos: @${notice.handle} ya muestra «Verificado por REPP».`
          : "REPP revisó y aprobó los cambios de tu negocio.",
      };
    case "REJECTED": {
      const reasons = notice.reasons.map((reason) => KYC_REJECTION_REASONS[reason]).join(" ");
      const next = notice.allowResubmit
        ? "Puedes corregirlo y enviar una nueva solicitud pasadas 24 horas."
        : "Esta decisión es definitiva.";
      return {
        subject: notice.materialChange ? "No aprobamos los cambios de tu negocio" : "No pudimos verificar tu negocio",
        body: `${reasons} ${notice.materialChange ? "Tu negocio sigue publicado con los datos anteriores." : next}`,
      };
    }
    case "SUSPENDED":
      return {
        subject: "Suspendimos tu negocio",
        body: `${BUSINESS_SUSPENSION_REASONS[notice.reason]} Tu negocio dejó de mostrarse en REPP mientras lo revisamos.`,
      };
    case "REINSTATED":
      return { subject: "Tu negocio volvió a publicarse", body: "REPP revisó tu caso y tu negocio vuelve a mostrarse." };
  }
}

/** In-app notices of the KYC (plan §2.12); suspension and reinstatement also by email. One per decision. */
@Injectable()
export class KycNotices {
  constructor(private readonly notifications: NotificationService) {}

  async send(recipientUserId: string, decisionId: string, notice: KycNotice, transaction: Transaction): Promise<void> {
    const { subject, body } = render(notice);
    const channels = notice.kind === "SUSPENDED" || notice.kind === "REINSTATED" ? [NotificationChannel.IN_APP, NotificationChannel.EMAIL] : [NotificationChannel.IN_APP];
    for (const channel of channels) {
      await this.notifications.enqueueDirectMessage(
        {
          recipientUserId,
          channel,
          subject,
          body,
          deduplicationKey: `business.kyc:${decisionId}:${channel}`,
          metadata: { kind: "BUSINESS_KYC", outcome: notice.kind, decisionId },
        },
        transaction,
      );
    }
  }
}
