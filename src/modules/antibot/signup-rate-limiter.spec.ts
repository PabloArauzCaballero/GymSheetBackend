import type Redis from "ioredis";
import { SignupRateLimiter } from "./signup-rate-limiter";
import { testAntibotConfig } from "./testing/antibot-test-config";

const ONE_HOUR = 60 * 60 * 1000;

describe("SignupRateLimiter", () => {
  let now: Date;
  beforeEach(() => {
    now = new Date("2026-11-16T10:00:00.000Z");
  });
  const limiter = (redis: Redis | null = null) => new SignupRateLimiter(testAntibotConfig(), () => now, redis);
  const input = { ip: "203.0.113.7", installationId: null, emailDomain: "example.test" };

  it("allows 5 signups per IP per hour and refuses the sixth, then resets with the window", async () => {
    const subject = limiter();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(subject.hit(input)).resolves.toEqual({ exceeded: false, ipCount: attempt });
    }
    await expect(subject.hit(input)).resolves.toMatchObject({ exceeded: true });
    now = new Date(now.getTime() + ONE_HOUR + 1);
    await expect(subject.hit(input)).resolves.toEqual({ exceeded: false, ipCount: 1 });
  });

  it("allows 3 signups per installation per day across different IPs", async () => {
    const subject = limiter();
    const hit = (index: number) => subject.hit({ ip: `198.51.100.${index}`, installationId: "inst-1", emailDomain: "example.test" });
    for (let index = 1; index <= 3; index += 1) await expect(hit(index)).resolves.toMatchObject({ exceeded: false });
    await expect(hit(4)).resolves.toMatchObject({ exceeded: true });
  });

  it("limits a non-allowlisted email domain to 30 per hour but never an allowlisted provider", async () => {
    const subject = limiter();
    const hit = (index: number, emailDomain: string) => subject.hit({ ip: `10.0.${Math.floor(index / 250)}.${index % 250}`, installationId: null, emailDomain });
    for (let index = 0; index < 30; index += 1) await hit(index, "bot-farm.example");
    await expect(hit(31, "bot-farm.example")).resolves.toMatchObject({ exceeded: true });
    for (let index = 100; index < 140; index += 1) await expect(hit(index, "gmail.com")).resolves.toMatchObject({ exceeded: false });
  });

  it("counts in Redis with a fixed window when it is configured", async () => {
    const exec = jest.fn().mockResolvedValue([[null, "OK"], [null, 6]]);
    const chain = { set: jest.fn(), incr: jest.fn(), exec };
    chain.set.mockReturnValue(chain);
    chain.incr.mockReturnValue(chain);
    const redis = { multi: jest.fn(() => chain) } as unknown as Redis;
    await expect(limiter(redis).hit(input)).resolves.toMatchObject({ exceeded: true, ipCount: 6 });
    expect(chain.set).toHaveBeenCalledWith(expect.stringMatching(/^signup:rl:ip:[0-9a-f]{32}$/), "0", "PX", ONE_HOUR, "NX");
    expect(JSON.stringify(chain.set.mock.calls)).not.toContain("203.0.113.7");
  });

  it("falls back to per-process counters when Redis fails instead of failing the signup", async () => {
    const redis = { multi: () => ({ set() { return this; }, incr() { return this; }, exec: () => Promise.reject(new Error("ECONNREFUSED")) }) } as unknown as Redis;
    await expect(limiter(redis).hit(input)).resolves.toEqual({ exceeded: false, ipCount: 1 });
  });
});
