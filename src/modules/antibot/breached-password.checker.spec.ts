import { createHash } from "node:crypto";
import { BreachedPasswordChecker } from "./breached-password.checker";
import { queuedFetch, testAntibotConfig } from "./testing/antibot-test-config";

const password = "correct horse battery staple";
const digest = createHash("sha1").update(password).digest("hex").toUpperCase();

describe("BreachedPasswordChecker", () => {
  const build = (...responses: (Response | Error)[]) => {
    const fake = queuedFetch(...responses);
    return { ...fake, checker: new BreachedPasswordChecker(testAntibotConfig({ breachCheckEnabled: true }), fake.fetcher) };
  };

  it("does nothing while disabled", async () => {
    const { fetcher, calls } = queuedFetch();
    await expect(new BreachedPasswordChecker(testAntibotConfig(), fetcher).check(password)).resolves.toBe("DISABLED");
    expect(calls).toHaveLength(0);
  });

  it("sends only the 5-character prefix and matches the suffix locally", async () => {
    const { checker, calls } = build(new Response(`0000000000000000000000000000000000A:3\r\n${digest.slice(5)}:42\r\n`));
    await expect(checker.check(password)).resolves.toBe("BREACHED");
    expect(calls[0].url).toBe(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`);
    expect(calls[0].url).not.toContain(digest.slice(5));
  });

  it("treats padding rows (count 0) and absent suffixes as clean", async () => {
    const { checker } = build(new Response(`${digest.slice(5)}:0\r\n`), new Response("ABC:1\r\n"));
    await expect(checker.check(password)).resolves.toBe("CLEAN");
    await expect(checker.check(password)).resolves.toBe("CLEAN");
  });

  it("reports UNAVAILABLE when the API cannot be reached", async () => {
    const { checker } = build(new TypeError("fetch failed"));
    await expect(checker.check(password)).resolves.toBe("UNAVAILABLE");
  });
});
