import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_FILE = join(__dirname, "data", "disposable-domains.txt");

/** Parses the versioned list: one domain per line, `#` comments and blanks ignored. */
export function parseDomainList(contents: string): ReadonlySet<string> {
  return new Set(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

let bundledList: ReadonlySet<string> | null = null;

/**
 * Loaded once per process. A missing file throws at first use instead of
 * silently accepting every domain: the Dockerfile asserts it ships in `dist`.
 */
export function bundledDisposableDomains(): ReadonlySet<string> {
  bundledList ??= parseDomainList(readFileSync(DATA_FILE, "utf8"));
  return bundledList;
}

/** Domain part of an address, lowercased; the address is already validated upstream. */
export function emailDomainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Layer 6: the domain or any parent of it is on the list, so `x.mailinator.com`
 * matches `mailinator.com`. Walking the suffixes avoids a public-suffix table.
 */
export function isDisposableDomain(domain: string, list: ReadonlySet<string>): boolean {
  const labels = domain.split(".");
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (list.has(labels.slice(index).join("."))) return true;
  }
  return false;
}
