import { Transaction } from "sequelize";
import { NotificationChannel } from "../../common/enums/domain.enums";
import { NotificationService } from "../notifications/notification.service";
import { NoticeEmailService } from "../notifications/notice-email.service";
import {
  ModerationReasonValue,
  ModerationTargetKindValue,
  Sanction,
  StrikeKind,
} from "./moderation.policy";

/**
 * What the affected person reads. Every notice names the reason (category plus
 * a short plain-language text): the legal texts promise "we tell you why", and a
 * sanction without a reason reads like an app failure.
 */
export type ModerationNotice = { subject: string; body: string; metadata: Record<string, unknown> };

/** Category label and short text per reason, in Spanish for the person. */
export const REASON_NOTICE: Record<ModerationReasonValue, { label: string; text: string }> = {
  CONTENIDO_SEXUAL: { label: "Contenido sexual", text: "contenido sexual o desnudos que las normas no permiten" },
  ACOSO: { label: "Acoso", text: "mensajes o contenido que hostigan o intimidan a otra persona" },
  DISCURSO_DE_ODIO: { label: "Discurso de odio", text: "ataques a personas por lo que son" },
  VIOLENCIA: { label: "Violencia", text: "amenazas o contenido violento" },
  SPAM: { label: "Spam", text: "publicidad o mensajes repetidos que nadie pidió" },
  PERFIL_FALSO: { label: "Perfil falso", text: "hacerse pasar por otra persona o usar datos falsos" },
  MENOR_DE_EDAD: { label: "Menor de edad", text: "la cuenta parece ser de una persona menor de 18 años" },
  DROGAS: { label: "Drogas", text: "venta o promoción de drogas" },
  EJERCICIO_PELIGROSO: { label: "Ejercicio peligroso", text: "ejercicios o consejos que pueden lesionar a alguien" },
  INFORMACION_ENGANOSA: { label: "Información engañosa", text: "información falsa que puede confundir o hacer daño" },
  PLAGIO: { label: "Plagio", text: "contenido de otra persona presentado como propio" },
  OTRO: { label: "Otro incumplimiento", text: "un incumplimiento de las normas de la comunidad" },
};

/** "Motivo: Acoso (mensajes o contenido que ...)." */
export function reasonSentence(reason: ModerationReasonValue): string {
  const notice = REASON_NOTICE[reason] ?? REASON_NOTICE.OTRO;
  return `Motivo: ${notice.label} (${notice.text}).`;
}

export function sanctionNotice(
  sanction: Sanction,
  reason: ModerationReasonValue,
  target: { kind: ModerationTargetKindValue; id: string },
): ModerationNotice {
  const metadata = {
    type: "MODERATION_SANCTION",
    sanction: sanction.kind,
    days: sanction.days,
    reason,
    refs: { targetKind: target.kind, targetId: target.id },
  };
  const why = reasonSentence(reason);
  if (sanction.kind === StrikeKind.ADVERTENCIA) {
    return {
      subject: "Aviso sobre tu contenido",
      body: `Recibiste un aviso por incumplir las normas de la comunidad. ${why} Es un aviso: si vuelve a ocurrir, tu cuenta puede quedar suspendida.`,
      metadata,
    };
  }
  if (sanction.kind === StrikeKind.EXPULSION) {
    return {
      subject: "Tu cuenta ha sido cerrada",
      body: `Cerramos tu cuenta por incumplimientos repetidos de las normas de la comunidad. ${why}`,
      metadata,
    };
  }
  const days = sanction.days ?? 0;
  return {
    subject: "Tu cuenta ha sido suspendida",
    body: `Suspendimos tu cuenta ${days === 1 ? "un día" : `${days} días`} por incumplir las normas de la comunidad. ${why} Podrás volver a entrar cuando termine.`,
    metadata,
  };
}

/** Content hidden: by the distinct-reporters threshold (pending review) or by a moderator. */
export function contentHiddenNotice(
  reason: ModerationReasonValue,
  target: { kind: ModerationTargetKindValue; id: string },
  pendingReview: boolean,
): ModerationNotice {
  return {
    subject: "Ocultamos contenido tuyo",
    body: pendingReview
      ? `Varias personas denunciaron contenido tuyo y lo ocultamos mientras una persona del equipo de moderación lo revisa. ${reasonSentence(reason)} Si no incumple las normas, vuelve a estar visible.`
      : `Revisamos contenido tuyo y lo retiramos por incumplir las normas de la comunidad. ${reasonSentence(reason)}`,
    metadata: { type: "CONTENT_HIDDEN", reason, pendingReview, refs: { targetKind: target.kind, targetId: target.id } },
  };
}

export function contentRestoredNotice(target: { kind: ModerationTargetKindValue; id: string }): ModerationNotice {
  return {
    subject: "Tu contenido vuelve a estar visible",
    body: "Revisamos el contenido tuyo que estaba oculto y no incumple las normas de la comunidad. Ya está visible otra vez.",
    metadata: { type: "CONTENT_RESTORED", refs: { targetKind: target.kind, targetId: target.id } },
  };
}

export function minorSuspensionNotice(): ModerationNotice {
  return {
    subject: "Suspendimos tu cuenta mientras revisamos una denuncia",
    body: `Recibimos una denuncia de que esta cuenta podría ser de una persona menor de 18 años, y REPP es solo para personas adultas. Suspendimos la cuenta mientras moderación lo revisa. ${reasonSentence("MENOR_DE_EDAD")}`,
    metadata: { type: "MODERATION_SUSPENSION_PENDING_REVIEW", reason: "MENOR_DE_EDAD" },
  };
}

export function minorClosureNotice(): ModerationNotice {
  return {
    subject: "Tu cuenta ha sido cerrada",
    body: `Confirmamos que la cuenta es de una persona menor de 18 años. REPP es solo para personas adultas, así que cerramos la cuenta y borramos sus datos. ${reasonSentence("MENOR_DE_EDAD")}`,
    metadata: { type: "MODERATION_MINOR_CLOSURE", reason: "MENOR_DE_EDAD" },
  };
}

/**
 * The minor review ended without confirming a minor and the provisional
 * suspension was lifted. It never says who reported: only that a review
 * happened and how the account stands now. When another sanction keeps the
 * account suspended (one still running, or one decided in this same review),
 * the notice says so instead of promising access; that sanction has its own notice.
 */
export function minorReviewClearedNotice(stillSuspended: boolean): ModerationNotice {
  return {
    subject: stillSuspended ? "Terminamos de revisar la denuncia sobre tu edad" : "Tu cuenta está activa otra vez",
    body: stillSuspended
      ? "Revisamos la denuncia de que esta cuenta podría ser de una persona menor de 18 años y no lo confirmamos, así que levantamos esa suspensión. Tu cuenta sigue suspendida por otra sanción: te contamos el motivo y hasta cuándo en su propio aviso."
      : "Revisamos la denuncia de que esta cuenta podría ser de una persona menor de 18 años y no lo confirmamos. Levantamos la suspensión: tu cuenta está activa otra vez y ya puedes entrar.",
    metadata: { type: "MODERATION_MINOR_REVIEW_CLEARED", reason: "MENOR_DE_EDAD", stillSuspended },
  };
}

/** Queues an in-app notice in the caller's transaction (outbox): it exists only if the decision commits. */
export async function sendModerationNotice(
  notifications: NotificationService,
  recipientUserId: string,
  notice: ModerationNotice,
  deduplicationKey: string,
  transaction?: Transaction,
): Promise<void> {
  await notifications.enqueueDirectMessage(
    {
      recipientUserId,
      channel: NotificationChannel.IN_APP,
      subject: notice.subject,
      body: notice.body,
      deduplicationKey,
      metadata: notice.metadata,
    },
    transaction,
  );
}

/**
 * Emails the same notice. Suspension, expulsion and the minor flow need it:
 * a suspended or banned account cannot open the in-app inbox, and a closed
 * one no longer has it. `survivesClosure` keeps the job through the closure
 * the notice announces.
 */
export async function emailModerationNotice(
  noticeEmails: NoticeEmailService,
  recipientUserId: string,
  notice: ModerationNotice,
  deduplicationKey: string,
  options: { survivesClosure?: boolean; transaction?: Transaction } = {},
): Promise<boolean> {
  return noticeEmails.enqueue(
    {
      recipientUserId,
      subject: notice.subject,
      body: notice.body,
      deduplicationKey,
      survivesClosure: options.survivesClosure ?? false,
    },
    options.transaction,
  );
}
