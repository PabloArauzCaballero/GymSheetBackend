import { MINIO_PUBLIC_OBJECT_PATTERNS } from "./adapters/minio-public-policy";
import { isBusinessKycKey, isDeletableContentKey, mediaObjectKey } from "./media-storage.port";

const ACCOUNT = "1b6f0d1e-0000-4000-8000-000000000001";
const SUBMISSION = "2c6f0d1e-0000-4000-8000-000000000002";
const OBJECT = "3d6f0d1e-0000-4000-8000-000000000003";
const KYC_KEY = `business/${ACCOUNT}/kyc/${SUBMISSION}/${OBJECT}.bin`;

/** S3 wildcards span '/', so `*` is `.*`. */
const matchesPattern = (key: string, pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*")}$`, "su").test(key);

describe("KYC document keys (ADR-0021)", () => {
  it("names a KYC document by its object id under the attempt's private folder", () => {
    expect(mediaObjectKey({ category: "kyc", accountId: ACCOUNT, submissionId: SUBMISSION, objectId: OBJECT }, "a".repeat(64), "application/octet-stream")).toBe(KYC_KEY);
  });

  it("keeps the content-addressed name for every other target", () => {
    expect(mediaObjectKey({ category: "catalog" }, "a".repeat(64), "image/png")).toBe(`catalog/${"a".repeat(64)}.png`);
  });

  it("is deletable (ADR-0017) and outside every anonymous read pattern", () => {
    expect(isBusinessKycKey(KYC_KEY)).toBe(true);
    expect(isDeletableContentKey(KYC_KEY)).toBe(true);
    expect(MINIO_PUBLIC_OBJECT_PATTERNS.filter((pattern) => matchesPattern(KYC_KEY, pattern))).toEqual([]);
  });

  it.each([
    `business/${ACCOUNT}/kyc/${SUBMISSION}/../public/x.bin`,
    `business/${ACCOUNT}/kyc/${SUBMISSION}/${OBJECT}.jpg`,
    `business/${ACCOUNT}/public/${OBJECT}.bin`,
  ])("does not treat %s as a KYC key", (key) => expect(isBusinessKycKey(key)).toBe(false));
});
