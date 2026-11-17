import { env } from "../../config/env";
import { ACCOUNT_CLOSURE_STEPS } from "../account/account-closure.catalog";
import { ClosureStep, anonymize, del, keep } from "../account/account-closure.steps";
import { RETIRED_LOCK_DAYS } from "../business-accounts/handle-rules";

/** The listing of the closing business account (1:1, ADR-0020). */
export const ACCOUNT_ENTITY = "(SELECT a.entity_id FROM business.accounts a WHERE a.user_id = :userId)";
const OWN_ENTITY = `t.entity_id = ${ACCOUNT_ENTITY}`;
const OWN_ACCOUNT = "t.account_id = :userId";
const OWN_SUBMISSION = "t.submission_id IN (SELECT s.id FROM business.kyc_submissions s WHERE s.account_id = :userId)";
/** Today in the business time zone (validated IANA name, see env). */
const TODAY = `(now() AT TIME ZONE '${env.BUSINESS_TIME_ZONE}')::date`;

/**
 * Not paid (yet): a QR order waiting for its receipt or whose receipt was
 * observed (the buyer could send another), or a cash order waiting for the
 * visit (ADR-0024).
 */
export const UNPAID_ORDER = "(t.status IN ('PENDING_PAYMENT', 'REJECTED') OR (t.status = 'PENDING_VERIFICATION' AND t.method = 'CASH'))";
/** A receipt the business has not decided yet: money may have moved, so the closure waits for it. */
export const RECEIPT_WAITING = "t.status = 'PENDING_VERIFICATION' AND t.method = 'QR'";

const KYC_REASON = "Se borran 180 días después del cierre (investigación de fraude); decisiones y huellas cifradas, a los 5 años.";
const BUYER_RECORD = "Cada comprador lo conserva como comprobante de su compra; ya no lleva datos de tu cuenta.";

/** Business rows: what happens to the listing, its sales and the people who depend on it (plan §2.14). */
const BUSINESS_STEPS: readonly ClosureStep[] = [
  // Applied by BusinessClosureService, row by row, with a notice to each person.
  { ...anonymize("directory.payment_orders", "Pedidos sin pagar o con el pago observado", `${OWN_ENTITY} AND ${UNPAID_ORDER}`, "status = 'CANCELLED'",
    "Se cancelan y avisamos a cada comprador que no pague."), effect: "CANCEL_UNPAID_ORDERS" },
  { ...anonymize("directory.affiliations", "Socios y coaches vinculados",
    `(t.gym_entity_id = ${ACCOUNT_ENTITY} OR t.coach_entity_id = ${ACCOUNT_ENTITY}) AND t.status IN ('REQUESTED', 'CONFIRMED')`,
    "status = 'ENDED'", "Las afiliaciones terminan y avisamos a cada persona."), effect: "END_AFFILIATIONS" },
  { ...anonymize("membership.memberships", "Suscripciones en curso o por empezar",
    `${OWN_ENTITY} AND t.origin = 'MARKETPLACE' AND t.status IN ('ACTIVE', 'SUSPENDED') AND (t.ends_on IS NULL OR t.ends_on >= ${TODAY})`,
    "status = 'CANCELLED'", "Se cancelan y avisamos a cada persona; los periodos ya vencidos quedan como historial."), effect: "CANCEL_PERIODS" },

  // The public profile goes; the name stays in the buyers' orders and chats.
  anonymize("directory.handles", "Tu @usuario", `t.owner_entity_id = ${ACCOUNT_ENTITY} AND t.status = 'ACTIVE'`,
    `status = 'RETIRED', redirect_to_handle = NULL, redirect_until = NULL,
     locked_until = now() + interval '${RETIRED_LOCK_DAYS} days', updated_at = now()`,
    `Deja de funcionar, sin redirección, y nadie puede tomarlo durante ${RETIRED_LOCK_DAYS} días.`),
  { ...anonymize("directory.handles", "Redirecciones de @usuarios anteriores",
    `t.owner_entity_id = ${ACCOUNT_ENTITY} AND t.status = 'RETIRED' AND t.redirect_to_handle IS NOT NULL`,
    "redirect_to_handle = NULL, redirect_until = NULL, updated_at = now()", "Dejan de redirigir a un negocio cerrado."), internal: true },
  del("directory.handles", "Reserva de @usuario sin publicar", `t.owner_entity_id = ${ACCOUNT_ENTITY} AND t.status = 'PENDING'`),
  anonymize("directory.entity_plans", "Publicaciones", `${OWN_ENTITY} AND (t.status <> 'ARCHIVED' OR t.media_urls <> '[]'::jsonb)`,
    "status = 'ARCHIVED', media_urls = '[]'::jsonb, updated_at = now()",
    "Se archivan y se borran sus fotos; los pedidos que ya se hicieron siguen citándolas."),
  keep("directory.plan_price_history", "Historial de precios",
    `t.plan_id IN (SELECT p.id FROM directory.entity_plans p WHERE p.entity_id = ${ACCOUNT_ENTITY})`, "Lo citan los pedidos de tus clientes."),
  del("directory.entity_payment_configs", "Datos de cobro y QR", OWN_ENTITY, "t.qr_private_key"),
  keep("directory.payment_orders", "Pedidos que recibiste", OWN_ENTITY, BUYER_RECORD),
  { ...anonymize("directory.payment_orders", "Quién decidió cada pedido", `${OWN_ENTITY} AND (t.decided_by_user_id = :userId OR t.verified_by_user_id = :userId)`,
    `decided_by_user_id = NULLIF(t.decided_by_user_id, CAST(:userId AS uuid)), verified_by_user_id = NULLIF(t.verified_by_user_id, CAST(:userId AS uuid))`,
    BUYER_RECORD), internal: true },
  keep("directory.affiliations", "Historial de afiliaciones",
    `(t.gym_entity_id = ${ACCOUNT_ENTITY} OR t.coach_entity_id = ${ACCOUNT_ENTITY}) AND t.status NOT IN ('REQUESTED', 'CONFIRMED')`,
    "Cada persona conserva las fechas de su afiliación."),
  keep("membership.memberships", "Suscripciones que vendiste", `${OWN_ENTITY} AND t.origin = 'MARKETPLACE'`, "Quedan como historial de cada persona."),
  // Append-only (trigger): the history keeps the id of the closed account, which carries no data any more.
  keep("membership.status_history", "Cambios que hiciste en suscripciones", "t.actor_user_id = :userId",
    "Historial de cada suscripción; tu cuenta figura como «Cuenta cerrada»."),
  keep("directory.entity_locations", "Sedes", OWN_ENTITY, "Las citan las afiliaciones de tus socios."),
  keep("directory.reviews", "Reseñas que recibiste", OWN_ENTITY, "Son de quienes las escribieron; dejan de verse con tu ficha."),
  keep("directory.handle_changes", "Cambios de @usuario", `${OWN_ENTITY}`, "Registro de los renombres; impide reutilizar un @usuario retirado."),
  del("chat.business_blocks", "Personas que bloqueaste en el chat", `t.business_entity_id = ${ACCOUNT_ENTITY}`),
  keep("chat.messages", "Tus mensajes con clientes",
    "t.sender_id = :userId AND t.conversation_id IN (SELECT c.id FROM chat.conversations c WHERE c.kind = 'BUSINESS')",
    "Quedan en el chat de cada cliente como constancia, en solo lectura con «Negocio cerrado»."),

  // The listing row and the account; logo, cover and gallery files are released by the service.
  anonymize("directory.entities", "Ficha del negocio", `t.id = ${ACCOUNT_ENTITY}`,
    `status = 'CLOSED', is_verified = false, logo_url = NULL, cover_url = NULL, gallery = '[]'::jsonb,
     contact_info = '{}'::jsonb, updated_at = now()`,
    "Deja de ser pública y se borran su logo, portada, fotos y contacto; el nombre queda en los pedidos y chats de tus clientes."),
  anonymize("business.accounts", "Cuenta de negocio", "t.user_id = :userId", "status = 'CLOSED', closed_at = now(), updated_at = now()",
    "Queda cerrada; nadie puede volver a entrar con ella."),

  // KYC: kept for the retention periods of plan §2.14 (KycRetentionService).
  del("business.phone_verifications", "Códigos de verificación del teléfono", OWN_ACCOUNT),
  keep("business.kyc_submissions", "Datos de tu verificación", OWN_ACCOUNT, KYC_REASON),
  keep("business.kyc_documents", "Documentos de tu verificación", `${OWN_SUBMISSION} AND t.deleted_at IS NULL`, KYC_REASON),
  keep("business.kyc_checks", "Comprobaciones automáticas", OWN_SUBMISSION, KYC_REASON),
  keep("business.kyc_decisions", "Decisiones de REPP sobre tu verificación", OWN_SUBMISSION, KYC_REASON),
  keep("business.kyc_status_history", "Historial de tu verificación", OWN_ACCOUNT, KYC_REASON),
  keep("business.identity_fingerprints", "Huellas cifradas de NIT, CI y teléfono", OWN_ACCOUNT, KYC_REASON),
];

/** Person-catalogue steps that apply to a business account as they are (sessions, notices, chat side effects, evidence). */
const SHARED_TABLES = new Set([
  "auth.refresh_tokens", "auth.user_devices", "auth.identities", "auth.email_verification_pins", "public.password_reset_tokens",
  "auth.account_exports", "auth.signup_audit", "auth.terms_acceptances", "auth.consents", "integration.outbox_jobs",
  "notifications.messages", "notifications.device_tokens", "notifications.preferences", "chat.message_reactions",
  "chat.message_visibility", "chat.read_receipt_settings", "chat.participants", "chat.conversation_timer_events", "chat.conversations",
  "moderation.reports", "moderation.user_strikes", "moderation.chat_message_evidence", "directory.review_replies",
  "directory.payment_order_history", "directory.affiliation_history", "integration.domain_events", "admin.audit_log",
]);

/**
 * The business's own chat messages are not wiped (a person's are): they are
 * the buyer's evidence of what was agreed (ADR-0023). The system support chat
 * of the account goes as for a person.
 */
const isWipeOfOwnMessages = (step: ClosureStep): boolean => step.table === "chat.messages" && step.disposition !== "DELETED";

/**
 * What closing a business account does (ADR-0028), in execution order: the
 * business rows first, then the account-wide steps shared with persons.
 * Every predicate is over the closing account (`:userId`).
 */
export const BUSINESS_CLOSURE_STEPS: readonly ClosureStep[] = [
  ...BUSINESS_STEPS,
  ...ACCOUNT_CLOSURE_STEPS.filter((step) => SHARED_TABLES.has(step.table) || (step.table === "chat.messages" && !isWipeOfOwnMessages(step))),
];
