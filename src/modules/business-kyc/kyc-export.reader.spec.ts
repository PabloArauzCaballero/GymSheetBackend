import { Sequelize } from "sequelize-typescript";
import { MediaStorageProvider } from "../media/media-storage.port";
import { KycCipher } from "./kyc-cipher";
import { KycExportReader } from "./kyc-export.reader";

const cipher = new KycCipher(() => "unit-kyc-key-0123456789abcdef0123456789");
const enc = (value: string) => cipher.encryptText(value);

function build(legalKind: "COMPANY" | "INDIVIDUAL", options: { business?: boolean } = {}) {
  const submission = {
    id: "s1", version: 1, status: "APPROVED", legalKind, nitMasked: "•••••••123", nitEnc: enc("1020304050"),
    repCiMasked: "••••567", repCiEnc: enc("1234567"), phoneMasked: "•••••890", phoneEnc: enc("+59171234890"),
  };
  const documents = ["CI_FRONT", "SELFIE", "SEPREC"].map((kind, index) => ({
    id: `d${index}`, submissionId: "s1", kind, mime: "image/jpeg", sha256: "a".repeat(64), storageKey: `business/u/kyc/s1/${index}.bin`, legalKind,
  }));
  const query = jest.fn()
    .mockResolvedValueOnce(options.business === false ? [] : [{ userId: "u" }])
    .mockResolvedValueOnce([submission])
    .mockResolvedValueOnce(documents);
  const storage = { download: jest.fn((key: string) => Promise.resolve(cipher.encrypt(Buffer.from(`image:${key}`)))) };
  const reader = new KycExportReader({ query } as unknown as Sequelize, cipher, storage as unknown as MediaStorageProvider);
  return { reader, storage };
}

describe("KycExportReader (ADR-0028)", () => {
  it("is null for an account that is not a business", async () => {
    await expect(build("COMPANY", { business: false }).reader.read("u")).resolves.toBeNull();
  });

  it("a COMPANY gets its NIT in clear but only the masks of its representative, whose CI and selfie are withheld", async () => {
    const { reader, storage } = build("COMPANY");
    const result = await reader.read("u");
    expect(result?.submissions[0]).toMatchObject({ nit: "1020304050", repCiNumber: "••••567", phone: "•••••890" });
    expect(JSON.stringify(result)).not.toContain("1234567");
    const byKind = Object.fromEntries((result?.documents ?? []).map((doc) => [doc.kind, doc]));
    expect(byKind.CI_FRONT).toMatchObject({ contentBase64: null, withheld: "REPRESENTATIVE_IDENTITY" });
    expect(byKind.SELFIE).toMatchObject({ contentBase64: null, withheld: "REPRESENTATIVE_IDENTITY" });
    expect(Buffer.from(byKind.SEPREC.contentBase64 ?? "", "base64").toString()).toBe("image:business/u/kyc/s1/2.bin");
    expect(storage.download).toHaveBeenCalledTimes(1);
  });

  it("an INDIVIDUAL (the owner is the person) gets its CI, phone and every document decrypted", async () => {
    const result = await build("INDIVIDUAL").reader.read("u");
    expect(result?.submissions[0]).toMatchObject({ repCiNumber: "1234567", phone: "+59171234890" });
    expect(result?.documents.every((doc) => doc.contentBase64 !== null && doc.withheld === null)).toBe(true);
  });

  it("lists a document it cannot read instead of failing the export", async () => {
    const { reader, storage } = build("INDIVIDUAL");
    storage.download.mockRejectedValue(new Error("gone"));
    const result = await reader.read("u");
    expect(result?.documents.every((doc) => doc.withheld === "UNREADABLE" && doc.contentBase64 === null)).toBe(true);
  });
});
