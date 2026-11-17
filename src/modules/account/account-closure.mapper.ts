import { ClosureStepCount } from "./account-closure.repository";
import { ClosureDisposition } from "./account-closure.steps";

export type ClosurePreviewItem = { table: string; label: string; count: number; reason: string | null };

/** Something that must be solved before closing (a business with receipts to decide, ADR-0028). */
export type ClosureBlocker = { code: "BUSINESS_HAS_PENDING_VERIFICATIONS"; count: number };

export type ClosurePreview = {
  /** False for staff accounts: the gym closes them. */
  allowed: boolean;
  /** Empty when the closure can go ahead now; the closure answers 409 with the same code otherwise. */
  blockers: ClosureBlocker[];
  /** How the closure is confirmed: always the password; an email PIN too for Google/Apple accounts. */
  proof: { password: true; emailPin: boolean };
  account: { label: string; disposition: "ANONYMIZED"; reason: string };
  deleted: ClosurePreviewItem[];
  anonymized: ClosurePreviewItem[];
  kept: ClosurePreviewItem[];
};

const PERSON_ACCOUNT: ClosurePreview["account"] = {
  label: "Tu cuenta",
  disposition: "ANONYMIZED",
  reason:
    "Se borran tu correo, nombre, fecha de nacimiento y sexo. Queda un identificador sin datos para que el gimnasio conserve sus registros contables. Tu correo podrá registrarse de nuevo.",
};

const BUSINESS_ACCOUNT: ClosurePreview["account"] = {
  label: "Tu cuenta de negocio",
  disposition: "ANONYMIZED",
  reason:
    "Se borran el correo y el nombre de la cuenta. Queda un identificador sin datos para que tus clientes conserven sus pedidos. El correo podrá registrarse de nuevo.",
};

/** Only tables with rows are listed: the screen shows what exists, not the whole schema. */
export function mapClosurePreview(
  counts: ClosureStepCount[],
  options: { allowed: boolean; pinAllowed: boolean; business?: boolean; blockers?: ClosureBlocker[] },
): ClosurePreview {
  const pick = (disposition: ClosureDisposition): ClosurePreviewItem[] =>
    counts
      .filter(({ step, count }) => step.disposition === disposition && count > 0)
      .map(({ step, count }) => ({ table: step.table, label: step.label, count, reason: step.reason ?? null }));
  return {
    allowed: options.allowed,
    blockers: options.blockers ?? [],
    proof: { password: true, emailPin: options.pinAllowed },
    account: options.business ? BUSINESS_ACCOUNT : PERSON_ACCOUNT,
    deleted: pick("DELETED"),
    anonymized: pick("ANONYMIZED"),
    kept: pick("KEPT"),
  };
}
