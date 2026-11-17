import { createHmac } from "node:crypto";
import { withIpHashSecret } from "../../common/privacy/testing/with-ip-hash-secret";
import { CarriedStrike, ClosedAccountSanctionsRepository, SanctionSnapshot } from "./closed-account-sanctions.repository";
import { ClosedAccountSanctionsService } from "./closed-account-sanctions.service";

const secret = "unit-privacy-pepper-0123456789abcdef";
const now = new Date("2026-11-18T12:00:00.000Z");
const transaction = { id: "tx" } as never;
const account = { id: "user-1", email: " Ana@Example.test ", tenantId: "gym-a" };
const emailHmac = createHmac("sha256", secret).update("email:ana@example.test").digest("hex");
const strike = (expiresAt: string): CarriedStrike => ({
  kind: "SUSPENSION",
  reason: "SPAM",
  tenantId: "gym-a",
  suspendedUntil: "2026-11-10T00:00:00.000Z",
  expiresAt,
});

function build(snapshot: SanctionSnapshot = { suspendedUntil: null, strikes: [] }, stored: SanctionSnapshot[] = []) {
  const repository = {
    activeSanction: jest.fn().mockResolvedValue(snapshot),
    insert: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(stored),
    insertStrikes: jest.fn().mockResolvedValue(undefined),
    setSuspension: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ClosedAccountSanctionsService(repository as unknown as ClosedAccountSanctionsRepository);
  return { service, repository };
}

describe("ClosedAccountSanctionsService.recordAtClosure", () => {
  it("stores nothing for an account without a running suspension or counting strikes", async () => {
    const { service, repository } = build();
    await expect(withIpHashSecret(secret, () => service.recordAtClosure(account, transaction, now))).resolves.toBe(false);
    expect(repository.activeSanction).toHaveBeenCalledWith("user-1", now, transaction);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("keeps the strikes under the keyed email hash until the last one stops counting", async () => {
    const until = new Date("2026-11-20T00:00:00.000Z");
    const strikes = [strike("2027-03-01T00:00:00.000Z"), strike("2027-11-01T00:00:00.000Z")];
    const { service, repository } = build({ suspendedUntil: until, strikes });
    await expect(withIpHashSecret(secret, () => service.recordAtClosure(account, transaction, now))).resolves.toBe(true);
    expect(repository.insert).toHaveBeenCalledWith(
      emailHmac,
      { suspendedUntil: until, strikes },
      new Date("2027-11-01T00:00:00.000Z"),
      transaction,
    );
  });

  it("cannot keep the email without the privacy pepper", async () => {
    const { service, repository } = build({ suspendedUntil: null, strikes: [strike("2027-03-01T00:00:00.000Z")] });
    await expect(withIpHashSecret(undefined, () => service.recordAtClosure(account, transaction, now))).resolves.toBe(false);
    expect(repository.insert).not.toHaveBeenCalled();
  });
});

describe("ClosedAccountSanctionsService.inheritAtSignup", () => {
  it("starts clean when no record matches the email", async () => {
    const { service, repository } = build();
    await expect(withIpHashSecret(secret, () => service.inheritAtSignup(account, transaction, now))).resolves.toBeNull();
    expect(repository.consume).toHaveBeenCalledWith(emailHmac, now, transaction);
    expect(repository.insertStrikes).not.toHaveBeenCalled();
  });

  it("re-creates the strikes and the running suspension on the new account", async () => {
    const until = new Date("2026-11-25T00:00:00.000Z");
    const strikes = [strike("2027-03-01T00:00:00.000Z")];
    const { service, repository } = build(undefined, [{ suspendedUntil: until, strikes }]);
    await expect(withIpHashSecret(secret, () => service.inheritAtSignup(account, transaction, now))).resolves.toEqual(until);
    expect(repository.insertStrikes).toHaveBeenCalledWith("user-1", "gym-a", strikes, transaction);
    expect(repository.setSuspension).toHaveBeenCalledWith("user-1", until, transaction);
  });

  it("carries the strikes but no suspension that already ended", async () => {
    const strikes = [strike("2027-03-01T00:00:00.000Z")];
    const { service, repository } = build(undefined, [{ suspendedUntil: new Date("2026-11-01T00:00:00.000Z"), strikes }]);
    await expect(withIpHashSecret(secret, () => service.inheritAtSignup(account, transaction, now))).resolves.toBeNull();
    expect(repository.insertStrikes).toHaveBeenCalledWith("user-1", "gym-a", strikes, transaction);
    expect(repository.setSuspension).not.toHaveBeenCalled();
  });
});

describe("ClosedAccountSanctionsService.hasActiveSanction", () => {
  it("is true with a running suspension or a counting strike, false for a clean account", async () => {
    await expect(build().service.hasActiveSanction("user-1", transaction, now)).resolves.toBe(false);
    await expect(build({ suspendedUntil: new Date("2026-12-01T00:00:00.000Z"), strikes: [] }).service.hasActiveSanction("user-1", transaction, now))
      .resolves.toBe(true);
    const warned = build({ suspendedUntil: null, strikes: [strike("2027-03-01T00:00:00.000Z")] });
    await expect(warned.service.hasActiveSanction("user-1", transaction, now)).resolves.toBe(true);
    expect(warned.repository.activeSanction).toHaveBeenCalledWith("user-1", now, transaction);
  });
});
