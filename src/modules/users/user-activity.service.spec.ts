import { Sequelize } from "sequelize-typescript";
import { ACTIVITY_WRITE_INTERVAL_MS, UserActivityService } from "./user-activity.service";

const userId = "00000000-0000-4000-8000-000000000001";

function serviceWith(query: jest.Mock) {
  return new UserActivityService({ query } as unknown as Sequelize);
}

describe("UserActivityService", () => {
  it("writes when the account was never active or the last write is stale", async () => {
    const query = jest.fn().mockResolvedValue([[], 1]);
    const service = serviceWith(query);
    const now = Date.now();
    service.recordIfStale(userId, null, now);
    service.recordIfStale(userId, new Date(now - ACTIVITY_WRITE_INTERVAL_MS - 1), now);
    await new Promise((resolve) => setImmediate(resolve));
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toMatchObject({ replacements: { userId } });
  });

  it("skips the write inside the 5-minute window", () => {
    const query = jest.fn();
    serviceWith(query).recordIfStale(userId, new Date(Date.now() - 60_000));
    expect(query).not.toHaveBeenCalled();
  });

  it("never fails the request when the write fails", async () => {
    const query = jest.fn().mockRejectedValue(new Error("database down"));
    expect(() => serviceWith(query).recordIfStale(userId, null)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(query).toHaveBeenCalledTimes(1);
  });
});
