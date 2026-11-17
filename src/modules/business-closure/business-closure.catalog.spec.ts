import { mediaKeysOf } from "../account/account-closure.steps";
import { BUSINESS_CLOSURE_STEPS, RECEIPT_WAITING, UNPAID_ORDER } from "./business-closure.catalog";
import { effectStep } from "./business-closure.repository";

const steps = (table: string) => BUSINESS_CLOSURE_STEPS.filter((step) => step.table === table);

describe("BUSINESS_CLOSURE_STEPS (ADR-0028)", () => {
  it("scopes every predicate to the closing account and leaves the account row to the repository", () => {
    for (const step of BUSINESS_CLOSURE_STEPS) expect([step.table, step.where.includes(":userId")]).toEqual([step.table, true]);
    expect(steps("public.usuarios")).toEqual([]);
  });

  it("gives every effect a visible step, so the preview counts what the closure then changes", () => {
    for (const effect of ["CANCEL_UNPAID_ORDERS", "END_AFFILIATIONS", "CANCEL_PERIODS"] as const) {
      const step = effectStep(effect);
      expect([effect, step.internal ?? false, step.disposition]).toEqual([effect, false, "ANONYMIZED"]);
    }
    expect(effectStep("CANCEL_UNPAID_ORDERS").where).toContain(UNPAID_ORDER);
    expect(effectStep("CANCEL_PERIODS").where).toContain("t.origin = 'MARKETPLACE'");
  });

  it("cancels unpaid and observed orders, never a receipt waiting for the business (that one blocks the closure)", () => {
    expect(UNPAID_ORDER).toContain("'PENDING_PAYMENT', 'REJECTED'");
    expect(UNPAID_ORDER).toContain("t.status = 'PENDING_VERIFICATION' AND t.method = 'CASH'");
    expect(RECEIPT_WAITING).toBe("t.status = 'PENDING_VERIFICATION' AND t.method = 'QR'");
  });

  it("retires the public handle without redirect, locked 180 days, and frees an unpublished reservation", () => {
    const [active, redirects, pending] = steps("directory.handles");
    expect(active.set).toContain("redirect_to_handle = NULL");
    expect(active.set).toContain("interval '180 days'");
    expect(redirects).toMatchObject({ internal: true });
    expect(pending).toMatchObject({ disposition: "DELETED" });
    expect(pending.where).toContain("t.status = 'PENDING'");
  });

  it("closes the listing, archives its listings and drops the payment data and its QR file", () => {
    expect(steps("directory.entities")[0].set).toContain("status = 'CLOSED'");
    expect(steps("directory.entity_plans")[0].set).toContain("status = 'ARCHIVED'");
    expect(steps("business.accounts")[0].set).toContain("status = 'CLOSED', closed_at = now()");
    const payment = steps("directory.entity_payment_configs")[0];
    expect([payment.disposition, mediaKeysOf(payment.mediaKey)]).toEqual(["DELETED", ["t.qr_private_key"]]);
  });

  it("keeps the business's chat messages for its customers and the KYC for its retention", () => {
    expect(steps("chat.messages").map((step) => step.disposition).sort()).toEqual(["DELETED", "KEPT"]);
    expect(steps("chat.messages").find((step) => step.disposition === "DELETED")?.where).toContain("system_kind IS NOT NULL");
    for (const table of ["business.kyc_submissions", "business.kyc_documents", "business.kyc_decisions", "business.identity_fingerprints"]) {
      expect([table, steps(table).map((step) => step.disposition)]).toEqual([table, ["KEPT"]]);
    }
    expect(steps("directory.payment_orders").filter((step) => step.disposition === "KEPT")).toHaveLength(1);
  });

  it("makes the person's side of every chat read-only and still ends the account's sessions and notices", () => {
    expect(steps("chat.participants").some((step) => step.internal && step.set === "can_write = false")).toBe(true);
    for (const table of ["auth.refresh_tokens", "auth.user_devices", "notifications.messages", "integration.outbox_jobs", "auth.consents"]) {
      expect([table, steps(table).length > 0]).toEqual([table, true]);
    }
    // Person-only tables never enter a business closure.
    for (const table of ["social.reels", "profile.photos", "training.routines", "membership.staff_profiles"]) expect(steps(table)).toEqual([]);
  });
});
