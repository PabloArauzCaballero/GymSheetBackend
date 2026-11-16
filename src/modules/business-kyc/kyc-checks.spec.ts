import type { Transaction } from "sequelize";
import { KYC_CHECKS, KycCheckContext, KycCheckQueries } from "./kyc-checks";
import { KycCheckCode } from "./kyc.catalog";

const tx = {} as Transaction;

function context(overrides: Partial<KycCheckContext> = {}): KycCheckContext {
  return {
    submissionId: "s",
    accountId: "a",
    entityId: "e",
    entityType: "GYM",
    legalKind: "COMPANY",
    purpose: "INITIAL",
    tradeName: "Gimnasio Prueba",
    handle: "gimnasio.prueba",
    description: "",
    signupRisk: "LOW",
    phoneVerified: true,
    documents: [
      { kind: "CI_FRONT", readable: true },
      { kind: "CI_BACK", readable: true },
      { kind: "SELFIE", readable: true },
    ],
    fingerprints: { NIT: "n".repeat(64), CI: "c".repeat(64), PHONE: "p".repeat(64), EMAIL: "e".repeat(64) },
    ...overrides,
  };
}

function queries(overrides: Partial<KycCheckQueries> = {}): KycCheckQueries {
  return {
    countOtherAccountsWith: jest.fn().mockResolvedValue(0),
    nameLooksTaken: jest.fn().mockResolvedValue(false),
    isBlocked: jest.fn().mockResolvedValue(false),
    hasClosedAccountSanction: jest.fn().mockResolvedValue(false),
    containsBannedTerm: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function check(code: KycCheckCode) {
  const found = KYC_CHECKS.find((entry) => entry.code === code);
  if (!found) throw new Error(`missing check ${code}`);
  return found;
}

describe("KYC automatic checks", () => {
  it("runs the checks of plan §2.6 and every one passes on a clean submission", async () => {
    expect(KYC_CHECKS.map((entry) => entry.code)).toEqual([
      "PHONE_VERIFIED", "DOCUMENTS_READABLE", "DUPLICATE_NIT", "DUPLICATE_CI", "DUPLICATE_PHONE", "DUPLICATE_EMAIL",
      "NAME_SIMILARITY", "ANTIBOT_RISK", "BLOCKLIST", "CLOSED_ACCOUNT_SANCTION", "BANNED_TERMS",
    ]);
    for (const entry of KYC_CHECKS) await expect(entry.run(context(), queries(), tx)).resolves.toMatchObject({ outcome: "PASS" });
  });

  it("PHONE_VERIFIED fails without a verified phone (no OTP provider → review, never approval)", async () => {
    await expect(check("PHONE_VERIFIED").run(context({ phoneVerified: false }), queries(), tx)).resolves.toEqual({
      outcome: "FAIL",
      detail: { reason: "NOT_VERIFIED" },
    });
  });

  it("DOCUMENTS_READABLE fails naming the unreadable required kinds", async () => {
    const documents = [
      { kind: "CI_FRONT" as const, readable: false },
      { kind: "CI_BACK" as const, readable: true },
      { kind: "SELFIE" as const, readable: true },
      { kind: "SEPREC" as const, readable: false },
    ];
    await expect(check("DOCUMENTS_READABLE").run(context({ documents }), queries(), tx)).resolves.toEqual({
      outcome: "FAIL",
      detail: { kinds: ["CI_FRONT"] },
    });
  });

  it.each([
    ["DUPLICATE_NIT", "NIT", "FAIL"],
    ["DUPLICATE_CI", "CI", "WARN"],
    ["DUPLICATE_PHONE", "PHONE", "FAIL"],
    ["DUPLICATE_EMAIL", "EMAIL", "FAIL"],
  ] as const)("%s looks for other accounts with the %s fingerprint (%s on a match)", async (code, kind, outcome) => {
    const probe = queries({ countOtherAccountsWith: jest.fn().mockResolvedValue(2) });
    await expect(check(code).run(context(), probe, tx)).resolves.toEqual({ outcome, detail: { matches: 2 } });
    expect(probe.countOtherAccountsWith).toHaveBeenCalledWith(kind, context().fingerprints[kind], "a", tx);
  });

  it("DUPLICATE_NIT does not apply to an individual without NIT", async () => {
    const probe = queries();
    const result = await check("DUPLICATE_NIT").run(context({ legalKind: "INDIVIDUAL", fingerprints: { CI: "c".repeat(64) } }), probe, tx);
    expect(result).toEqual({ outcome: "PASS", detail: { applicable: false } });
    expect(probe.countOtherAccountsWith).not.toHaveBeenCalled();
  });

  it("NAME_SIMILARITY fails when a public listing or a REPP reservation looks the same", async () => {
    const probe = queries({ nameLooksTaken: jest.fn().mockResolvedValue(true) });
    await expect(check("NAME_SIMILARITY").run(context(), probe, tx)).resolves.toEqual({ outcome: "FAIL" });
    expect(probe.nameLooksTaken).toHaveBeenCalledWith("Gimnasio Prueba", "GYM", "e", tx);
  });

  it.each(["MEDIUM", "HIGH", null] as const)("ANTIBOT_RISK fails for a %s signup", async (risk) => {
    await expect(check("ANTIBOT_RISK").run(context({ signupRisk: risk }), queries(), tx)).resolves.toEqual({
      outcome: "FAIL",
      detail: { risk: risk ?? "UNKNOWN" },
    });
  });

  it("BLOCKLIST probes every fingerprint and keeps no detail (no oracle)", async () => {
    const probe = queries({ isBlocked: jest.fn().mockResolvedValue(true) });
    await expect(check("BLOCKLIST").run(context(), probe, tx)).resolves.toEqual({ outcome: "FAIL" });
    expect(probe.isBlocked).toHaveBeenCalledWith(
      expect.arrayContaining([{ kind: "NIT", hmac: "n".repeat(64) }, { kind: "EMAIL", hmac: "e".repeat(64) }]),
      tx,
    );
  });

  it("CLOSED_ACCOUNT_SANCTION fails on a sanction inherited by the email", async () => {
    const probe = queries({ hasClosedAccountSanction: jest.fn().mockResolvedValue(true) });
    await expect(check("CLOSED_ACCOUNT_SANCTION").run(context(), probe, tx)).resolves.toEqual({ outcome: "FAIL" });
    expect(probe.hasClosedAccountSanction).toHaveBeenCalledWith("e".repeat(64), tx);
  });

  it("BANNED_TERMS looks at the name, the handle and the description", async () => {
    const probe = queries({ containsBannedTerm: jest.fn().mockResolvedValue(true) });
    await expect(check("BANNED_TERMS").run(context({ description: "venta" }), probe, tx)).resolves.toEqual({ outcome: "FAIL" });
    expect(probe.containsBannedTerm).toHaveBeenCalledWith(["Gimnasio Prueba", "gimnasio.prueba", "venta"], tx);
  });
});
