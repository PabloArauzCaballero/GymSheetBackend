import type { Transaction } from "sequelize";
import { CONSENT_VERSIONS } from "../legal/consent-versions";
import type { ConsentRow, ConsentsRepository } from "./consents.repository";
import { setConsentSchema } from "./consents.schemas";
import { ConsentsService } from "./consents.service";

const userId = "00000000-0000-4000-8000-0000000000c1";
const transaction = {} as Transaction;

function setup(open: ConsentRow | null = null, latest: ConsentRow[] = []) {
  const repository = {
    runInTransaction: jest.fn((work: (t: Transaction) => Promise<unknown>) => work(transaction)),
    latestPerKind: jest.fn().mockResolvedValue(latest),
    findOpen: jest.fn().mockResolvedValue(open),
    close: jest.fn().mockResolvedValue(undefined),
    open: jest.fn().mockResolvedValue(undefined),
    eraseData: jest.fn().mockResolvedValue(undefined),
  };
  return { service: new ConsentsService(repository as unknown as ConsentsRepository), repository };
}

const row = (overrides: Partial<ConsentRow> = {}): ConsentRow => ({
  kind: "ORIENTATION",
  version: CONSENT_VERSIONS.ORIENTATION,
  grantedAt: new Date("2026-11-01T00:00:00.000Z"),
  revokedAt: null,
  ...overrides,
});

describe("ConsentsService", () => {
  it("lists every kind, marking never-granted ones and outdated versions", async () => {
    const { service } = setup(null, [row({ version: "LEGACY" })]);
    const { consents } = await service.list(userId);
    expect(consents.map((consent) => consent.kind)).toEqual(["HEALTH", "ORIENTATION", "VERIFICATION_SELFIE", "PRECISE_LOCATION"]);
    expect(consents[0]).toMatchObject({ granted: false, version: null, upToDate: false, grantedAt: null });
    expect(consents[1]).toMatchObject({ granted: true, version: "LEGACY", upToDate: false });
  });

  it("asks again whoever accepted the previous texts (2026-12-01, third legal review N2)", async () => {
    const kinds = ["HEALTH", "ORIENTATION", "VERIFICATION_SELFIE", "PRECISE_LOCATION"] as const;
    const { service } = setup(null, kinds.map((kind) => row({ kind, version: "2026-12-01" })));
    const { consents } = await service.list(userId);
    for (const consent of consents) {
      expect(consent).toMatchObject({ granted: true, version: "2026-12-01", upToDate: false });
      expect(consent.currentVersion).not.toBe("2026-12-01");
    }
    await expect(setup().service.set(userId, "HEALTH", { granted: true, version: "2026-12-01" }, "IOS"))
      .rejects.toMatchObject({ code: "CONSENT_VERSION_OUTDATED" });
  });

  it("grants the current version once and is idempotent for the same version", async () => {
    const { service, repository } = setup();
    await service.set(userId, "ORIENTATION", { granted: true, version: CONSENT_VERSIONS.ORIENTATION }, "IOS");
    expect(repository.open).toHaveBeenCalledWith(userId, "ORIENTATION", CONSENT_VERSIONS.ORIENTATION, "IOS", transaction);

    const again = setup(row());
    await again.service.set(userId, "ORIENTATION", { granted: true, version: CONSENT_VERSIONS.ORIENTATION }, "IOS");
    expect(again.repository.open).not.toHaveBeenCalled();
    expect(again.repository.close).not.toHaveBeenCalled();
  });

  it("replaces an open grant of an older version", async () => {
    const { service, repository } = setup(row({ version: "LEGACY" }));
    await service.set(userId, "ORIENTATION", { granted: true, version: CONSENT_VERSIONS.ORIENTATION }, "WEB");
    expect(repository.close).toHaveBeenCalledWith(userId, "ORIENTATION", transaction);
    expect(repository.open).toHaveBeenCalled();
  });

  it("rejects a grant of an outdated text with 409 CONSENT_VERSION_OUTDATED", async () => {
    const { service, repository } = setup();
    await expect(
      service.set(userId, "HEALTH", { granted: true, version: "2000-01-01" }, "WEB"),
    ).rejects.toMatchObject({ code: "CONSENT_VERSION_OUTDATED", status: 409 });
    expect(repository.open).not.toHaveBeenCalled();
  });

  it.each(["HEALTH", "ORIENTATION", "PRECISE_LOCATION", "VERIFICATION_SELFIE"] as const)(
    "revoking %s closes the grant and erases its data in the same transaction",
    async (kind) => {
      const { service, repository } = setup(row({ kind }));
      await service.set(userId, kind, { granted: false }, "WEB");
      expect(repository.close).toHaveBeenCalledWith(userId, kind, transaction);
      expect(repository.eraseData).toHaveBeenCalledWith(userId, kind, transaction);
    },
  );

  it("requires an open consent with 400 CONSENT_REQUIRED, under a share lock", async () => {
    const { service, repository } = setup(null);
    await expect(service.assertGranted(userId, "PRECISE_LOCATION", transaction)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
      status: 400,
    });
    expect(repository.findOpen).toHaveBeenCalledWith(userId, "PRECISE_LOCATION", transaction, "SHARE");
    await expect(setup(row()).service.assertGranted(userId, "ORIENTATION", transaction)).resolves.toBeUndefined();
  });

  it("requires a version only to grant", () => {
    expect(setConsentSchema.safeParse({ granted: true }).success).toBe(false);
    expect(setConsentSchema.safeParse({ granted: false }).success).toBe(true);
    expect(setConsentSchema.safeParse({ granted: "yes", version: "x" }).success).toBe(false);
  });
});
