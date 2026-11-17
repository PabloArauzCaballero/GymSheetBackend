import { PRODUCT_NAME, brandNameOf } from "./product-name";

describe("brandNameOf", () => {
  it("uses the gym's display name when the tenant has one", () => {
    expect(brandNameOf("  Top Fitness ")).toBe("Top Fitness");
  });

  it("falls back to the product name, REPP", () => {
    expect(PRODUCT_NAME).toBe("REPP");
    expect(brandNameOf(null)).toBe("REPP");
    expect(brandNameOf(undefined)).toBe("REPP");
    expect(brandNameOf("   ")).toBe("REPP");
  });
});
