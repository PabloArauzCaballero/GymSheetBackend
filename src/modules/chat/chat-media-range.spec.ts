import { parseByteRange } from "./chat-media-range";

describe("parseByteRange", () => {
  it("returns null without a header or with one it does not support", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
    expect(parseByteRange("bytes=-", 100)).toBeNull();
  });

  it("reads the probe AVPlayer sends first", () => {
    expect(parseByteRange("bytes=0-1", 39050)).toEqual({ start: 0, end: 1 });
  });

  it("clamps an end past the file and supports open and suffix ranges", () => {
    expect(parseByteRange("bytes=100-999999", 1000)).toEqual({ start: 100, end: 999 });
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("flags ranges that fall outside the file", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=5-2", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});
