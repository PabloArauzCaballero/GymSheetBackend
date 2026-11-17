import { HttpStatus } from "@nestjs/common";
import { DomainException } from "../../common/errors/domain.exception";
import type { ConversationKind } from "./conversation.model";
import type { MessageType } from "./message.model";

/** New business conversations a person may open in a rolling 24 h window (ADR-0023). */
export const BUSINESS_CONVERSATIONS_PER_DAY = 10;

/**
 * A business conversation is evidence for a dispute over an order: nothing in
 * it expires (enforced again by a CHECK on the table) and nobody shares a
 * live location with a business. Both run under the conversation row lock.
 */
export function assertBusinessMessageAllowed(kind: ConversationKind, type: MessageType): void {
  if (kind === "BUSINESS" && type === "location") {
    throw new DomainException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "BUSINESS_CHAT_NO_LOCATION",
      "En el chat con un negocio no se comparte la ubicación.",
    );
  }
}

export function assertBusinessDisappearingAllowed(kind: ConversationKind, seconds: number | null): void {
  if (kind === "BUSINESS" && seconds !== null) {
    throw new DomainException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      "BUSINESS_CHAT_NO_DISAPPEARING",
      "En el chat con un negocio los mensajes no se borran solos: quedan como constancia.",
    );
  }
}

export function businessChatLimitReached(): DomainException {
  return new DomainException(
    HttpStatus.TOO_MANY_REQUESTS,
    "BUSINESS_CHAT_LIMIT",
    `Puedes escribir a ${BUSINESS_CONVERSATIONS_PER_DAY} negocios nuevos por día. Vuelve a intentarlo mañana.`,
  );
}

export function businessChatBlocked(): DomainException {
  return new DomainException(HttpStatus.FORBIDDEN, "BUSINESS_CHAT_BLOCKED", "Este negocio no recibe tus mensajes.");
}

export function businessSenderLocked(): DomainException {
  return new DomainException(HttpStatus.CONFLICT, "BUSINESS_ACCOUNT_LOCKED", "Tu negocio está suspendido o cerrado: no puede enviar mensajes.");
}
