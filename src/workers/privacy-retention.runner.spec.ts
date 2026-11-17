import type { PrivacyRetentionResult, PrivacyRetentionService } from "../modules/privacy/privacy-retention.service";
import {
  PRIVACY_RETENTION_INTERVAL_MS,
  PRIVACY_RETENTION_JITTER_MS,
  PrivacyRetentionRunner,
  nextPrivacyRetentionDelayMs,
} from "./privacy-retention.runner";

const result = { ticketsDeleted: 0 } as unknown as PrivacyRetentionResult;

describe("PrivacyRetentionRunner", () => {
  afterEach(() => jest.useRealTimers());

  it("waits a day plus up to 30 minutes of jitter between runs", () => {
    expect(nextPrivacyRetentionDelayMs(() => 0)).toBe(PRIVACY_RETENTION_INTERVAL_MS);
    expect(nextPrivacyRetentionDelayMs(() => 0.999999)).toBeLessThan(PRIVACY_RETENTION_INTERVAL_MS + PRIVACY_RETENTION_JITTER_MS);
    expect(PRIVACY_RETENTION_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("runs the retention after the start jitter, again after 24 h, and stops on abort", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-16T00:00:00.000Z") });
    const controller = new AbortController();
    const purge = jest.fn<Promise<PrivacyRetentionResult>, [Date]>().mockResolvedValue(result);
    const running = new PrivacyRetentionRunner({ purge } as unknown as PrivacyRetentionService).run(controller.signal, () => 0.5);

    await jest.advanceTimersByTimeAsync(PRIVACY_RETENTION_JITTER_MS / 2 - 1);
    expect(purge).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith(new Date("2026-11-16T00:15:00.000Z"));

    await jest.advanceTimersByTimeAsync(PRIVACY_RETENTION_INTERVAL_MS + PRIVACY_RETENTION_JITTER_MS / 2);
    expect(purge).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(running).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("survives a failing pass instead of killing the worker", async () => {
    const controller = new AbortController();
    const purge = jest.fn(() => {
      controller.abort();
      return Promise.reject(new Error("database unreachable"));
    });

    await expect(
      new PrivacyRetentionRunner({ purge } as unknown as PrivacyRetentionService).run(controller.signal, () => 0),
    ).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
