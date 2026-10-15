import {
  IsoBmffMetadataError,
  parseIsoBmffVideoMetadata,
} from "./iso-bmff-metadata";

function box(type: string, payload: Buffer, extended = false): Buffer {
  const header = Buffer.alloc(extended ? 16 : 8);
  if (extended) {
    header.writeUInt32BE(1, 0);
    header.write(type, 4, 4, "ascii");
    header.writeBigUInt64BE(BigInt(header.length + payload.length), 8);
  } else {
    header.writeUInt32BE(header.length + payload.length, 0);
    header.write(type, 4, 4, "ascii");
  }
  return Buffer.concat([header, payload]);
}

function fullBoxPayload(version: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([version, 0, 0, 0]), payload]);
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
}
function i32(value: number): Buffer {
  const result = Buffer.alloc(4);
  result.writeInt32BE(value);
  return result;
}

function makeVideoTrack(
  durationTicks: number | bigint,
  timescale: number,
  options: {
    version?: number;
    handler?: string;
    chunkOffset?: number;
    sampleSize?: number;
    sampleCount?: number;
    sttsDuration?: number;
    editList?: Array<{ duration: number; mediaTime: number }>;
  } = {},
): Buffer {
  const version = options.version ?? 0;
  const mediaHeader = Buffer.alloc(version === 1 ? 28 : 16);
  if (version === 0) {
    mediaHeader.writeUInt32BE(0, 0); // creation time
    mediaHeader.writeUInt32BE(0, 4); // modification time
    mediaHeader.writeUInt32BE(timescale, 8);
    mediaHeader.writeUInt32BE(Number(durationTicks), 12);
  } else {
    mediaHeader.writeBigUInt64BE(0n, 0); // creation time
    mediaHeader.writeBigUInt64BE(0n, 8); // modification time
    mediaHeader.writeUInt32BE(timescale, 16);
    mediaHeader.writeBigUInt64BE(BigInt(durationTicks), 20);
  }
  const mdhd = box("mdhd", fullBoxPayload(version, mediaHeader));

  const handlerPayload = Buffer.alloc(24);
  handlerPayload.write(options.handler ?? "vide", 4, 4, "ascii");
  const hdlr = box("hdlr", fullBoxPayload(0, handlerPayload));
  const sampleCount = options.sampleCount ?? 1;
  const sampleSize = options.sampleSize ?? 4;
  const stsd = box(
    "stsd",
    fullBoxPayload(0, Buffer.concat([u32(1), box("avc1", Buffer.alloc(8))])),
  );
  const stts = box(
    "stts",
    fullBoxPayload(
      0,
      Buffer.concat([
        u32(1),
        u32(sampleCount),
        u32(options.sttsDuration ?? Number(durationTicks) / sampleCount),
      ]),
    ),
  );
  const stsz = box(
    "stsz",
    fullBoxPayload(
      0,
      Buffer.concat([
        u32(0),
        u32(sampleCount),
        ...Array.from({ length: sampleCount }, () => u32(sampleSize)),
      ]),
    ),
  );
  const stsc = box(
    "stsc",
    fullBoxPayload(
      0,
      Buffer.concat([u32(1), u32(1), u32(sampleCount), u32(1)]),
    ),
  );
  const stco = box(
    "stco",
    fullBoxPayload(0, Buffer.concat([u32(1), u32(options.chunkOffset ?? 0)])),
  );
  const stbl = box("stbl", Buffer.concat([stsd, stts, stsz, stsc, stco]));
  const mdia = box("mdia", Buffer.concat([mdhd, hdlr, box("minf", stbl)]));
  const edits = options.editList
    ? box(
        "edts",
        box(
          "elst",
          fullBoxPayload(
            0,
            Buffer.concat([
              u32(options.editList.length),
              ...options.editList.flatMap(({ duration, mediaTime }) => [
                u32(duration),
                i32(mediaTime),
                Buffer.from([0, 1, 0, 0]),
              ]),
            ]),
          ),
        ),
      )
    : Buffer.alloc(0);
  return box("trak", Buffer.concat([edits, mdia]));
}

function makeMovieHeader(durationTicks: number): Buffer {
  const payload = Buffer.alloc(96);
  payload.writeUInt32BE(1000, 8);
  payload.writeUInt32BE(durationTicks, 12);
  return box("mvhd", fullBoxPayload(0, payload));
}

function makeMp4(
  durationTicks: number | bigint,
  timescale: number,
  options: {
    version?: number;
    handler?: string;
    brand?: string;
    compatibleBrands?: string[];
    fragmented?: boolean;
    extendedMdat?: boolean;
    movieDuration?: number;
    editList?: Array<{ duration: number; mediaTime: number }>;
    sampleSize?: number;
    sampleCount?: number;
    sttsDuration?: number;
    badChunkOffset?: number;
    mdatSize?: number;
  } = {},
): Buffer {
  const brand = options.brand ?? "isom";
  const ftyp = box(
    "ftyp",
    Buffer.concat([
      Buffer.from(brand, "ascii"),
      Buffer.alloc(4), // minor version
      ...(options.compatibleBrands ?? ["mp42"]).map((compatible) =>
        Buffer.from(compatible, "ascii"),
      ),
    ]),
  );
  const movieDuration =
    options.movieDuration ??
    Math.ceil((Number(durationTicks) / timescale) * 1000);
  const buildMoov = (chunkOffset: number) =>
    box(
      "moov",
      Buffer.concat([
        makeMovieHeader(movieDuration),
        makeVideoTrack(durationTicks, timescale, {
          version: options.version,
          handler: options.handler,
          chunkOffset: options.badChunkOffset ?? chunkOffset,
          sampleSize: options.sampleSize,
          sampleCount: options.sampleCount,
          sttsDuration: options.sttsDuration,
          editList: options.editList,
        }),
        ...(options.fragmented ? [box("mvex", Buffer.alloc(0))] : []),
      ]),
    );
  const moovSize = buildMoov(0).length;
  const moov = buildMoov(
    ftyp.length + moovSize + (options.extendedMdat ? 16 : 8),
  );
  const mediaData = box(
    "mdat",
    Buffer.alloc(
      options.mdatSize ??
        (options.sampleSize ?? 4) * (options.sampleCount ?? 1),
    ),
    options.extendedMdat,
  );
  const fragment = options.fragmented
    ? box("moof", Buffer.alloc(0))
    : Buffer.alloc(0);
  return Buffer.concat([ftyp, moov, fragment, mediaData]);
}

function expectParserError(run: () => unknown, code: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(IsoBmffMetadataError);
  expect(caught).toMatchObject({ code });
}

describe("parseIsoBmffVideoMetadata", () => {
  it.each([
    [899, 89.9],
    [900, 90],
  ])("accepts duration %s/10 as %s seconds", (ticks, expectedSeconds) => {
    const metadata = parseIsoBmffVideoMetadata(
      makeMp4(ticks, 10, { extendedMdat: true }),
    );
    expect(metadata.durationTicks).toBe(BigInt(ticks));
    expect(metadata.timescale).toBe(10);
    expect(metadata.durationSeconds).toBe(expectedSeconds);
    expect(metadata.compatibleBrands).toContain("mp42");
  });

  it("parses version 1 media headers without losing 64-bit duration precision", () => {
    const metadata = parseIsoBmffVideoMetadata(
      makeMp4(900n, 10, { version: 1 }),
    );
    expect(metadata.durationTicks).toBe(900n);
    expect(metadata.durationSeconds).toBe(90);
  });

  it("accepts a supported major brand when the compatible-brand list is empty", () => {
    const metadata = parseIsoBmffVideoMetadata(
      makeMp4(900, 10, { brand: "isom", compatibleBrands: [] }),
    );
    expect(metadata.compatibleBrands).toEqual([]);
  });

  it("rejects durations greater than 90 seconds", () => {
    expectParserError(
      () => parseIsoBmffVideoMetadata(makeMp4(901, 10)),
      "DURATION_EXCEEDS_LIMIT",
    );
  });

  it("rejects an over-limit mvhd timeline even when the video track is within limit", () => {
    expectParserError(
      () =>
        parseIsoBmffVideoMetadata(makeMp4(900, 10, { movieDuration: 90_100 })),
      "DURATION_EXCEEDS_LIMIT",
    );
  });

  it("uses a valid edit list presentation duration and permits a trimmed source", () => {
    const metadata = parseIsoBmffVideoMetadata(
      makeMp4(1_000, 10, {
        movieDuration: 90_000,
        editList: [{ duration: 90_000, mediaTime: 100 }],
      }),
    );
    expect(metadata.durationSeconds).toBe(90);
    expect(metadata.timescale).toBe(1000);
  });

  it("rejects edit lists that start beyond mdhd", () => {
    expect(() =>
      parseIsoBmffVideoMetadata(
        makeMp4(1_000, 10, {
          movieDuration: 90_000,
          editList: [{ duration: 90_000, mediaTime: 1_000 }],
        }),
      ),
    ).toThrow("starts beyond the track duration");
  });

  it("rejects an edit list longer than mvhd", () => {
    expect(() =>
      parseIsoBmffVideoMetadata(
        makeMp4(1_000, 10, {
          movieDuration: 90_000,
          editList: [{ duration: 90_001, mediaTime: 0 }],
        }),
      ),
    ).toThrow("exceeds the movie timeline");
  });

  it("rejects chunk offsets outside mdat payload", () => {
    expect(() =>
      parseIsoBmffVideoMetadata(makeMp4(900, 10, { badChunkOffset: 1 })),
    ).toThrow("outside mdat");
  });

  it("rejects stts duration and sample table inconsistencies", () => {
    expect(() =>
      parseIsoBmffVideoMetadata(makeMp4(900, 10, { sttsDuration: 899 })),
    ).toThrow("does not match the media duration");
    expect(() =>
      parseIsoBmffVideoMetadata(
        makeMp4(900, 10, { sampleSize: 5, mdatSize: 4 }),
      ),
    ).toThrow("outside mdat");
  });

  it("rejects malformed box sizes", () => {
    const bytes = makeMp4(900, 10);
    bytes.writeUInt32BE(7, 0);
    expect(() => parseIsoBmffVideoMetadata(bytes)).toThrow(
      IsoBmffMetadataError,
    );
  });

  it("rejects containers with an excessive number of boxes", () => {
    const base = makeMp4(900, 10);
    const ftypSize = base.readUInt32BE(0);
    const moovSize = base.readUInt32BE(ftypSize);
    const padding = Buffer.concat(
      Array.from({ length: 100_001 }, () => box("free", Buffer.alloc(0))),
    );
    const bytes = Buffer.concat([
      base.subarray(0, ftypSize + moovSize),
      padding,
      base.subarray(ftypSize + moovSize),
    ]);
    expect(() => parseIsoBmffVideoMetadata(bytes)).toThrow("too many boxes");
  });

  it("rejects a file with an incompatible ftyp brand", () => {
    expectParserError(
      () =>
        parseIsoBmffVideoMetadata(
          makeMp4(900, 10, { brand: "webm", compatibleBrands: ["webm"] }),
        ),
      "UNSUPPORTED_BRAND",
    );
  });

  it("rejects truncated input", () => {
    const bytes = makeMp4(900, 10);
    expect(() =>
      parseIsoBmffVideoMetadata(bytes.subarray(0, bytes.length - 2)),
    ).toThrow(IsoBmffMetadataError);
  });

  it("rejects a valid MP4 container without a video track", () => {
    expectParserError(
      () => parseIsoBmffVideoMetadata(makeMp4(900, 10, { handler: "soun" })),
      "VIDEO_TRACK_REQUIRED",
    );
  });

  it("rejects fragmented files and ambiguous movie metadata", () => {
    expectParserError(
      () => parseIsoBmffVideoMetadata(makeMp4(900, 10, { fragmented: true })),
      "FRAGMENTED_MEDIA",
    );
    const valid = makeMp4(900, 10);
    const ftypEnd = valid.readUInt32BE(0);
    const duplicateMovie = Buffer.concat([
      valid.subarray(0, ftypEnd),
      box("moov", Buffer.alloc(0)),
      valid.subarray(ftypEnd),
    ]);
    expectParserError(
      () => parseIsoBmffVideoMetadata(duplicateMovie),
      "AMBIGUOUS_METADATA",
    );
  });
});
