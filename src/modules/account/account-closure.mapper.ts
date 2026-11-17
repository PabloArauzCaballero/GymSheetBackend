import { ClosureStepCount } from "./account-closure.repository";
import { ClosureDisposition } from "./account-closure.steps";

export type ClosurePreviewItem = { table: string; label: string; count: number; reason: string | null };

export type ClosurePreview = {
  /** False for staff accounts: the gym closes them. */
  allowed: boolean;
  /** How the closure is confirmed: always the password; an email PIN too for Google/Apple accounts. */
  proof: { password: true; emailPin: boolean };
  account: { label: string; disposition: "ANONYMIZED"; reason: string };
  deleted: ClosurePreviewItem[];
  anonymized: ClosurePreviewItem[];
  kept: ClosurePreviewItem[];
};

/** Only tables with rows are listed: the screen shows what exists, not the whole schema. */
export function mapClosurePreview(
  counts: ClosureStepCount[],
  options: { allowed: boolean; pinAllowed: boolean },
): ClosurePreview {
  const pick = (disposition: ClosureDisposition): ClosurePreviewItem[] =>
    counts
      .filter(({ step, count }) => step.disposition === disposition && count > 0)
      .map(({ step, count }) => ({ table: step.table, label: step.label, count, reason: step.reason ?? null }));
  return {
    allowed: options.allowed,
    proof: { password: true, emailPin: options.pinAllowed },
    account: {
      label: "Tu cuenta",
      disposition: "ANONYMIZED",
      reason:
        "Se borran tu correo, nombre, fecha de nacimiento y sexo. Queda un identificador sin datos para que el gimnasio conserve sus registros contables. Tu correo podrá registrarse de nuevo.",
    },
    deleted: pick("DELETED"),
    anonymized: pick("ANONYMIZED"),
    kept: pick("KEPT"),
  };
}
