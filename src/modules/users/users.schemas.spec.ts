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

  it("accepts a branch uuid and rejects anything else", () => {
    expect(
      updateMyAccountSchema.safeParse({ sedeId: "3f1c2b7e-8a4d-4c1e-9b2a-5d6e7f8a9b0c" }).success,
    ).toBe(true);
    expect(updateMyAccountSchema.safeParse({ sedeId: "sede-1" }).success).toBe(false);
  });
});
