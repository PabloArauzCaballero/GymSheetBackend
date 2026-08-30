import { updateMyAccountSchema } from "./users.schemas";

describe("updateMyAccountSchema", () => {
  it("accepts a positive weight increment", () => {
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: 1.25 }).success).toBe(true);
  });

  it("rejects a zero or negative increment", () => {
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: 0 }).success).toBe(false);
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: -2.5 }).success).toBe(false);
  });

  it("rejects an unrealistically large increment", () => {
    expect(updateMyAccountSchema.safeParse({ pesoIncrementoKg: 51 }).success).toBe(false);
  });

  it("rejects an empty update", () => {
    expect(updateMyAccountSchema.safeParse({}).success).toBe(false);
  });
});
