import { HttpStatus } from "@nestjs/common";
import { Request } from "express";
import { Transaction } from "sequelize";
import { DomainException } from "../../common/errors/domain.exception";
import { LegalClientContext, legalClientContext } from "./legal-client-context";
import { CONSENT_VERSIONS } from "./consent-versions";
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_CONTENT_SHA256 } from "./legal-documents";
import { LegalRepository } from "./legal.repository";
import { LegalService } from "./legal.service";

const userId = "00000000-0000-4000-8000-000000000001";
const context: LegalClientContext = { channel: "WEB", ipHmac: null, userAgent: "jest" };
const transaction = {} as Transaction;
const current = () => [
  { document: "TERMS", version: LEGAL_DOCUMENTS.TERMS, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.TERMS },
  { document: "PRIVACY", version: LEGAL_DOCUMENTS.PRIVACY, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.PRIVACY },
  { document: "COMMUNITY", version: LEGAL_DOCUMENTS.COMMUNITY, contentSha256: LEGAL_DOCUMENT_CONTENT_SHA256.COMMUNITY },
];

function createService(overrides: Partial<Record<keyof LegalRepository, jest.Mock>> = {}) {
  const repository = {
    findPending: jest.fn().mockResolvedValue([]),
    insertAcceptances: jest.fn().mockResolvedValue(undefined),
    touchLegacyTermsColumns: jest.fn().mockResolvedValue(undefined),
    runInTransaction: jest.fn((work: (t: Transaction) => Promise<unknown>) => work(transaction)),
    ...overrides,
  };
  return { service: new LegalService(repository as unknown as LegalRepository), repository };
}

function expectDomainError(action: () => unknown, status: HttpStatus, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).getStatus()).toBe(status);
    expect((error as DomainException).code).toBe(code);
    return;
  }
  throw new Error("expected a DomainException");
}

describe("LegalService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("treats the community rules as a versioned document with the same version as the others", () => {
    expect(LEGAL_DOCUMENTS.COMMUNITY).toBe(LEGAL_DOCUMENTS.TERMS);
    expect(LEGAL_DOCUMENT_CONTENT_SHA256.COMMUNITY).toBeNull();
  });

  it("asks for the community rules when they are the only pending document", async () => {
    const findPending = jest.fn().mockResolvedValue([{ document: "COMMUNITY", version: LEGAL_DOCUMENTS.COMMUNITY }]);
    const { service } = createService({ findPending });
    await expect(service.hasPending(userId)).resolves.toBe(true);
    expect(findPending).toHaveBeenCalledWith(userId, current());
  });

  it("lists every current document with its text hash and every consent version", () => {
    expect(createService().service.currentDocuments()).toEqual({
      documents: current(),
      consents: [
        { kind: "HEALTH", version: CONSENT_VERSIONS.HEALTH },
        { kind: "ORIENTATION", version: CONSENT_VERSIONS.ORIENTATION },
        { kind: "VERIFICATION_SELFIE", version: CONSENT_VERSIONS.VERIFICATION_SELFIE },
        { kind: "PRECISE_LOCATION", version: CONSENT_VERSIONS.PRECISE_LOCATION },
      ],
    });
  });

  it("records the hash of the published text with the accepted version", async () => {
    const hash = "a".repeat(64);
    jest.replaceProperty(LEGAL_DOCUMENT_CONTENT_SHA256, "TERMS", hash);
    const { service, repository } = createService();
    await service.accept(userId, { acceptances: [{ document: "TERMS", version: LEGAL_DOCUMENTS.TERMS }] }, context);
    expect(repository.insertAcceptances).toHaveBeenCalledWith(
      userId,
      [{ document: "TERMS", version: LEGAL_DOCUMENTS.TERMS, contentSha256: hash }],
      context,
      transaction,
    );
  });

  it("rejects an outdated signup terms version with 409 TERMS_VERSION_OUTDATED", () => {
    const { service } = createService();
    expectDomainError(() => service.assertCurrentTermsVersion("2000-01-01"), HttpStatus.CONFLICT, "TERMS_VERSION_OUTDATED");
    expect(() => service.assertCurrentTermsVersion(LEGAL_DOCUMENTS.TERMS)).not.toThrow();
  });

  it("records every current document inside the signup transaction", async () => {
    const { service, repository } = createService();
    await service.recordSignupAcceptances(userId, context, transaction);
    expect(repository.insertAcceptances).toHaveBeenCalledWith(userId, current(), context, transaction);
  });

  it("reports pending documents for the requesting user only", async () => {
    const findPending = jest.fn().mockResolvedValue([{ document: "PRIVACY", version: "x" }]);
    const { service } = createService({ findPending });
    await expect(service.pending(userId)).resolves.toEqual({ pending: [{ document: "PRIVACY", version: "x" }] });
    await expect(service.hasPending(userId)).resolves.toBe(true);
    expect(findPending).toHaveBeenCalledWith(userId, current());
  });

  it("accepts current versions atomically and keeps the legacy terms columns in step", async () => {
    const { service, repository } = createService();
    await expect(service.accept(userId, { acceptances: current() as never }, context)).resolves.toEqual({ pending: [] });
    expect(repository.insertAcceptances).toHaveBeenCalledWith(userId, current(), context, transaction);
    expect(repository.touchLegacyTermsColumns).toHaveBeenCalledWith(userId, LEGAL_DOCUMENTS.TERMS, transaction);
  });

  it("does not touch the legacy terms columns when only the privacy policy is accepted", async () => {
    const { service, repository } = createService();
    await service.accept(userId, { acceptances: [{ document: "PRIVACY", version: LEGAL_DOCUMENTS.PRIVACY }] }, context);
    expect(repository.touchLegacyTermsColumns).not.toHaveBeenCalled();
  });

  it("refuses to record a version that is not the current one", async () => {
    const { service, repository } = createService();
    await expect(
      service.accept(userId, { acceptances: [{ document: "TERMS", version: "2000-01-01" }] }, context),
    ).rejects.toMatchObject({ code: "TERMS_VERSION_OUTDATED" });
    expect(repository.insertAcceptances).not.toHaveBeenCalled();
  });
});

describe("legalClientContext", () => {
  const request = (headers: Record<string, string>, ip = "203.0.113.7") =>
    ({ ip, header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

  it("normalizes the platform header and falls back to UNKNOWN", () => {
    expect(legalClientContext(request({ "x-client-platform": "ios" }), undefined).channel).toBe("IOS");
    expect(legalClientContext(request({ "x-client-platform": "toaster" }), undefined).channel).toBe("UNKNOWN");
    expect(legalClientContext(request({}), undefined).channel).toBe("UNKNOWN");
  });

  it("stores a keyed hash of the IP only when a secret is configured, never the raw IP", () => {
    expect(legalClientContext(request({}), undefined).ipHmac).toBeNull();
    const hashed = legalClientContext(request({}), "s".repeat(32)).ipHmac;
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain("203.0.113.7");
  });

  it("truncates the user agent to 400 characters", () => {
    expect(legalClientContext(request({ "user-agent": "a".repeat(500) }), undefined).userAgent).toHaveLength(400);
  });
});
