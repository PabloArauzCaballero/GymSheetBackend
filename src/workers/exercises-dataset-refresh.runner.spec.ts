import { millisecondsUntilDatasetRefresh } from "./exercises-dataset-refresh.runner";

describe("millisecondsUntilDatasetRefresh", () => {
  const day = 86_400_000;
  const now = new Date("2026-07-22T12:00:00.000Z");

  it("refreshes immediately when PostgreSQL has no cached dataset", () => {
    expect(millisecondsUntilDatasetRefresh(null, now, day)).toBe(0);
  });

  it("waits until 24 hours after the last successful import", () => {
    const importedTwelveHoursAgo = new Date(now.getTime() - day / 2);

    expect(
      millisecondsUntilDatasetRefresh(importedTwelveHoursAgo, now, day),
    ).toBe(day / 2);
  });

  it("refreshes immediately when the cache is stale", () => {
    const importedTwoDaysAgo = new Date(now.getTime() - day * 2);

    expect(millisecondsUntilDatasetRefresh(importedTwoDaysAgo, now, day)).toBe(
      0,
    );
  });
});
