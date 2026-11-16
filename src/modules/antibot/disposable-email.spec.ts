import { bundledDisposableDomains, emailDomainOf, isDisposableDomain, parseDomainList } from "./disposable-email";

describe("disposable email domains", () => {
  it("loads the versioned list shipped with the module", () => {
    const list = bundledDisposableDomains();
    expect(list.size).toBeGreaterThan(300);
    expect(list.has("mailinator.com")).toBe(true);
    expect([...list].some((domain) => domain.startsWith("#"))).toBe(false);
  });

  it("matches a listed domain and any of its subdomains, case-insensitively", () => {
    const list = parseDomainList("# comment\nmailinator.com\n\nyopmail.com\n");
    expect(isDisposableDomain(emailDomainOf("Bot@MAILINATOR.com"), list)).toBe(true);
    expect(isDisposableDomain(emailDomainOf("bot@inbox.eu.mailinator.com"), list)).toBe(true);
  });

  it("does not match lookalikes or real providers", () => {
    const list = bundledDisposableDomains();
    for (const domain of ["notmailinator.org", "mailinator.com.ar", "gmail.com", "outlook.com", "example.test"]) {
      expect(isDisposableDomain(domain, list)).toBe(false);
    }
  });
});
