import type { BusinessSuspensionReason } from "../business-kyc/kyc.catalog";
import type { ModerationReasonValue } from "./moderation.policy";

/**
 * The suspension reason a business reads (`KycNotices`) for the moderation
 * reason of the case (ADR-0022). Closed map: what does not fit is `OTHER`.
 */
const SUSPENSION_REASON_BY_REPORT: Partial<Record<ModerationReasonValue, BusinessSuspensionReason>> = {
  PERFIL_FALSO: "IMPERSONATION",
  INFORMACION_ENGANOSA: "FRAUD_SUSPECTED",
  DROGAS: "PROHIBITED_ACTIVITY",
  CONTENIDO_SEXUAL: "PROHIBITED_ACTIVITY",
  VIOLENCIA: "PROHIBITED_ACTIVITY",
};

export function businessSuspensionReasonFor(reason: ModerationReasonValue): BusinessSuspensionReason {
  return SUSPENSION_REASON_BY_REPORT[reason] ?? "OTHER";
}
