import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUSINESS_LEGAL_TEXTS_ARE_DRAFTS,
  LEGAL_DOCUMENT_CONTENT_SHA256,
  LEGAL_DOCUMENT_SOURCES,
  LEGAL_DOCUMENT_TYPES,
  LegalDocument,
} from "./legal-documents";

const repositoryRoot = join(__dirname, "..", "..", "..");
const sources = Object.entries(LEGAL_DOCUMENT_SOURCES) as [LegalDocument, string][];

describe("legal document catalog", () => {
  it("has a source file for each business document", () => {
    expect(sources.map(([document]) => document).sort()).toEqual(["BUSINESS_DPA", "BUSINESS_TERMS"]);
  });

  it.each(sources)("the hash of %s is the hash of its file, so the catalog cannot drift from the text", (document, path) => {
    const text = readFileSync(join(repositoryRoot, path));
    expect(LEGAL_DOCUMENT_CONTENT_SHA256[document]).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("the draft flag and the draft marker of the texts agree", () => {
    const drafts = sources.map(([, path]) => readFileSync(join(repositoryRoot, path), "utf8").includes("BORRADOR — no publicar"));
    expect(drafts.every((draft) => draft === BUSINESS_LEGAL_TEXTS_ARE_DRAFTS)).toBe(true);
  });

  it("every document type is known to the acceptance CHECK of the migration", () => {
    expect([...LEGAL_DOCUMENT_TYPES]).toEqual(["TERMS", "PRIVACY", "COMMUNITY", "BUSINESS_TERMS", "BUSINESS_DPA"]);
  });
});
