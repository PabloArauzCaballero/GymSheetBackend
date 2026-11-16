import type { Transaction } from "sequelize";
import type { ConsentsService } from "../consents/consents.service";
import { LedgerVerificationConsent } from "./verification-consent.port";

describe("LedgerVerificationConsent", () => {
  it("requires the current VERIFICATION_SELFIE grant from the consent ledger, inside the caller transaction", async () => {
    const consents = { assertCurrentGranted: jest.fn().mockResolvedValue(undefined) };
    const adapter = new LedgerVerificationConsent(consents as unknown as ConsentsService);
    const transaction = { id: "tx" } as unknown as Transaction;

    await adapter.assertGranted("u1", transaction);
    await adapter.assertGranted("u1");

    expect(consents.assertCurrentGranted.mock.calls).toEqual([
      ["u1", "VERIFICATION_SELFIE", transaction],
      ["u1", "VERIFICATION_SELFIE", undefined],
    ]);
  });

  it("lets the ledger's 400 CONSENT_REQUIRED through untouched", async () => {
    const missing = Object.assign(new Error("sin consentimiento"), { code: "CONSENT_REQUIRED" });
    const consents = { assertCurrentGranted: jest.fn().mockRejectedValue(missing) };
    await expect(new LedgerVerificationConsent(consents as unknown as ConsentsService).assertGranted("u1")).rejects.toBe(missing);
  });
});
