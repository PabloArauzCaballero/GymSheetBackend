import { ciFingerprintValue, maskTail, normalizeBolivianMobile, normalizeNit, parseCi } from "./kyc-formats";

describe("KYC formats (shape only, no invented check digit)", () => {
  it.each([
    ["1020304050", "1020304050"],
    ["1.020.304-050", "1020304050"],
    ["1234567", "1234567"],
    ["1234567890123", "1234567890123"],
  ])("accepts the NIT %s", (input, expected) => expect(normalizeNit(input)).toBe(expected));

  it.each(["123456", "12345678901234", "12A4567", "", "   "])("refuses the NIT %s", (input) => expect(normalizeNit(input)).toBeNull());

  it("accepts any digit sequence of a valid length: no check digit is computed", () => {
    // Consecutive numbers differ only in the last digit; a check-digit rule would refuse most of them.
    for (let last = 0; last <= 9; last += 1) expect(normalizeNit(`102030405${last}`)).toBe(`102030405${last}`);
  });

  it("parses a CI with complement and department", () => {
    expect(parseCi("1234567", "1a", "lp")).toEqual({ number: "1234567", complement: "1A", extension: "LP" });
    expect(parseCi("4321", null, null)).toEqual({ number: "4321", complement: null, extension: null });
    expect(parseCi("12 345 67", "", "")).toEqual({ number: "1234567", complement: null, extension: null });
  });

  it.each([
    ["123", null, null],
    ["12345678901", null, null],
    ["12345A", null, null],
    ["1234567", "1", null],
    ["1234567", "1-A", null],
    ["1234567", null, "XX"],
  ])("refuses the CI %s / %s / %s", (number, complement, extension) => expect(parseCi(number, complement, extension)).toBeNull());

  it("fingerprints a CI by its number alone: neither the department nor the complement can dodge a match", () => {
    expect(ciFingerprintValue(parseCi("1234567", "1A", "LP")!)).toBe(ciFingerprintValue(parseCi("1234567", "1A", "SC")!));
    expect(ciFingerprintValue(parseCi("1234567", "1A", null)!)).toBe(ciFingerprintValue(parseCi("1234567", null, null)!));
    expect(ciFingerprintValue(parseCi("1234567", "2B", null)!)).toBe("1234567");
  });

  it.each([
    ["71234567", "+59171234567"],
    ["+591 71234567", "+59171234567"],
    ["591-6123-4567", "+59161234567"],
  ])("normalizes the Bolivian mobile %s", (input, expected) => expect(normalizeBolivianMobile(input)).toBe(expected));

  it.each(["21234567", "7123456", "+54 9 11 1234 5678", "712345678"])("refuses %s", (input) => expect(normalizeBolivianMobile(input)).toBeNull());

  it("masks all but the tail", () => expect(maskTail("1020304050")).toBe("•••••••050"));
});
