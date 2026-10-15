/** Bounded metadata reader for non-fragmented ISO BMFF video uploads. */
export interface IsoBmffVideoMetadata {
  readonly durationTicks: bigint;
  readonly timescale: number;
  readonly durationSeconds: number;
  readonly compatibleBrands: readonly string[];
}

export type IsoBmffMetadataErrorCode =
  | "INVALID_CONTAINER"
  | "UNSUPPORTED_BRAND"
  | "FRAGMENTED_MEDIA"
  | "AMBIGUOUS_METADATA"
  | "VIDEO_TRACK_REQUIRED"
  | "INVALID_DURATION"
  | "DURATION_EXCEEDS_LIMIT";

export class IsoBmffMetadataError extends Error {
  constructor(
    readonly code: IsoBmffMetadataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IsoBmffMetadataError";
  }
}

const MAX_REEL_DURATION_SECONDS = 90n;
const MAX_BOXES_PER_PARENT = 10_000;
const MAX_TABLE_ENTRIES = 100_000;
const SUPPORTED_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "qt  ",
  "3gp4",
  "3gp5",
  "3gp6",
]);

interface Box {
  readonly type: string;
  readonly start: number;
  readonly payloadStart: number;
  readonly end: number;
}
interface TrackMetadata {
  readonly handler: string;
  readonly durationTicks: bigint;
  readonly timescale: number;
  readonly track: Box;
}

interface MovieMetadata {
  readonly durationTicks: bigint;
  readonly timescale: number;
}

function invalid(message: string): never {
  throw new IsoBmffMetadataError("INVALID_CONTAINER", message);
}

function readBoxes(buffer: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) invalid("Truncated ISO BMFF box header.");
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    let size: bigint;
    if (size32 === 1) {
      if (end - offset < 16) invalid("Truncated extended ISO BMFF box header.");
      size = buffer.readBigUInt64BE(offset + 8);
      headerSize = 16;
    } else if (size32 === 0) {
      invalid("ISO BMFF boxes with size 0 are not accepted.");
    } else {
      size = BigInt(size32);
    }
    if (!/^[\x20-\x7e]{4}$/u.test(type)) invalid("Invalid ISO BMFF box type.");
    if (size < BigInt(headerSize))
      invalid("ISO BMFF box size is smaller than its header.");
    const boxEnd = BigInt(offset) + size;
    if (boxEnd > BigInt(end) || boxEnd > BigInt(Number.MAX_SAFE_INTEGER)) {
      invalid("ISO BMFF box exceeds its parent bounds.");
    }
    boxes.push({
      type,
      start: offset,
      payloadStart: offset + headerSize,
      end: Number(boxEnd),
    });
    if (boxes.length > MAX_BOXES_PER_PARENT)
      invalid("ISO BMFF parent contains too many boxes.");
    offset = Number(boxEnd);
  }
  if (offset !== end)
    invalid("ISO BMFF boxes do not end at their parent boundary.");
  return boxes;
}

function childrenOf(buffer: Buffer, box: Box): Box[] {
  return readBoxes(buffer, box.payloadStart, box.end);
}

function parseFileType(buffer: Buffer, box: Box): string[] {
  const size = box.end - box.payloadStart;
  if (size < 8 || (size - 8) % 4 !== 0) invalid("Invalid ISO BMFF ftyp box.");
  const major = buffer.toString(
    "ascii",
    box.payloadStart,
    box.payloadStart + 4,
  );
  const brands = [major];
  for (let offset = box.payloadStart + 8; offset < box.end; offset += 4) {
    brands.push(buffer.toString("ascii", offset, offset + 4));
  }
  if (!brands.some((brand) => SUPPORTED_BRANDS.has(brand))) {
    throw new IsoBmffMetadataError(
      "UNSUPPORTED_BRAND",
      "Unsupported ISO BMFF file brand.",
    );
  }
  return [...new Set(brands.slice(1))];
}

function parseHandler(buffer: Buffer, box: Box): string {
  if (box.end - box.payloadStart < 24 || buffer[box.payloadStart] !== 0) {
    invalid("Invalid ISO BMFF hdlr box.");
  }
  return buffer.toString("ascii", box.payloadStart + 8, box.payloadStart + 12);
}

function parseMediaHeader(
  buffer: Buffer,
  box: Box,
): Pick<TrackMetadata, "durationTicks" | "timescale"> {
  const payloadSize = box.end - box.payloadStart;
  const version = buffer[box.payloadStart];
  let timescaleOffset: number;
  let durationOffset: number;
  let durationBytes: number;
  if (version === 0) {
    if (payloadSize < 20) invalid("Invalid version 0 ISO BMFF mdhd box.");
    timescaleOffset = box.payloadStart + 12;
    durationOffset = box.payloadStart + 16;
    durationBytes = 4;
  } else if (version === 1) {
    if (payloadSize < 32) invalid("Invalid version 1 ISO BMFF mdhd box.");
    timescaleOffset = box.payloadStart + 20;
    durationOffset = box.payloadStart + 24;
    durationBytes = 8;
  } else {
    invalid("Unsupported ISO BMFF mdhd version.");
  }
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const durationTicks =
    durationBytes === 8
      ? buffer.readBigUInt64BE(durationOffset)
      : BigInt(buffer.readUInt32BE(durationOffset));
  if (
    timescale === 0 ||
    durationTicks === 0n ||
    durationTicks === 0xffff_ffffn ||
    durationTicks === 0xffff_ffff_ffff_ffffn
  ) {
    throw new IsoBmffMetadataError(
      "INVALID_DURATION",
      "ISO BMFF media duration is missing or ambiguous.",
    );
  }
  return { durationTicks, timescale };
}

function onlyChild(
  buffer: Buffer,
  parent: Box,
  type: string,
  required = true,
): Box | undefined {
  const matches = childrenOf(buffer, parent).filter(
    (child) => child.type === type,
  );
  if (matches.length > 1 || (required && matches.length !== 1)) {
    throw new IsoBmffMetadataError(
      "AMBIGUOUS_METADATA",
      `ISO BMFF ${type} metadata must be unique.`,
    );
  }
  return matches[0];
}

function parseMovieHeader(buffer: Buffer, box: Box): MovieMetadata {
  const size = box.end - box.payloadStart;
  const version = buffer[box.payloadStart];
  const timescaleOffset = box.payloadStart + (version === 1 ? 20 : 12);
  const durationOffset = box.payloadStart + (version === 1 ? 24 : 16);
  const durationBytes = version === 1 ? 8 : 4;
  if ((version !== 0 && version !== 1) || size < (version === 1 ? 32 : 20))
    invalid("Invalid ISO BMFF mvhd box.");
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const durationTicks =
    durationBytes === 8
      ? buffer.readBigUInt64BE(durationOffset)
      : BigInt(buffer.readUInt32BE(durationOffset));
  if (
    timescale === 0 ||
    durationTicks === 0n ||
    durationTicks === 0xffff_ffffn ||
    durationTicks === 0xffff_ffff_ffff_ffffn
  ) {
    throw new IsoBmffMetadataError(
      "INVALID_DURATION",
      "ISO BMFF movie duration is missing or ambiguous.",
    );
  }
  return { durationTicks, timescale };
}

function parseEditList(
  buffer: Buffer,
  track: Box,
  mediaDuration: bigint,
): bigint | undefined {
  const edts = onlyChild(buffer, track, "edts", false);
  if (!edts) return undefined;
  const elst = onlyChild(buffer, edts, "elst")!;
  const size = elst.end - elst.payloadStart;
  const version = buffer[elst.payloadStart];
  const countOffset = elst.payloadStart + 4;
  const count = buffer.readUInt32BE(countOffset);
  const entrySize = version === 1 ? 20 : 12;
  if (
    (version !== 0 && version !== 1) ||
    count === 0 ||
    count > MAX_TABLE_ENTRIES ||
    size !== 8 + count * entrySize
  )
    invalid("Invalid ISO BMFF elst box.");
  let offset = countOffset + 4;
  let presentationTicks = 0n;
  let hasMedia = false;
  for (let index = 0; index < count; index += 1) {
    const segmentDuration =
      version === 1
        ? buffer.readBigUInt64BE(offset)
        : BigInt(buffer.readUInt32BE(offset));
    offset += version === 1 ? 8 : 4;
    const mediaTime =
      version === 1
        ? buffer.readBigInt64BE(offset)
        : BigInt(buffer.readInt32BE(offset));
    offset += version === 1 ? 8 : 4;
    const rateInteger = buffer.readInt16BE(offset);
    const rateFraction = buffer.readInt16BE(offset + 2);
    offset += 4;
    if (
      segmentDuration === 0n ||
      (mediaTime < 0n && mediaTime !== -1n) ||
      rateInteger !== 1 ||
      rateFraction !== 0
    )
      invalid("Unsupported or invalid ISO BMFF edit list entry.");
    presentationTicks += segmentDuration;
    if (mediaTime !== -1n) {
      hasMedia = true;
      // B-frame encoders commonly add a positive composition offset and use
      // an edit list to skip that decode-time lead-in. Validate the edit start
      // against mdhd; the edit's presentation length is bounded by mvhd below.
      if (mediaTime >= mediaDuration) {
        throw new IsoBmffMetadataError(
          "INVALID_DURATION",
          "ISO BMFF edit list starts beyond the track duration.",
        );
      }
    }
  }
  if (!hasMedia)
    invalid("ISO BMFF edit list contains no media-backed presentation.");
  return presentationTicks;
}

function parseSampleTables(
  buffer: Buffer,
  track: Box,
  mdia: Box,
  mediaDuration: bigint,
  mdiaScale: number,
  mdats: Box[],
): void {
  const minf = onlyChild(buffer, mdia, "minf")!;
  const stbl = onlyChild(buffer, minf, "stbl")!;
  const stsd = onlyChild(buffer, stbl, "stsd")!;
  const stts = onlyChild(buffer, stbl, "stts")!;
  const stsz = onlyChild(buffer, stbl, "stsz")!;
  const stsc = onlyChild(buffer, stbl, "stsc")!;
  const stco = onlyChild(buffer, stbl, "stco", false);
  const co64 = onlyChild(buffer, stbl, "co64", false);
  if (!!stco === !!co64)
    invalid("ISO BMFF sample table requires exactly one chunk offset table.");

  const stsdCount = readTableCount(buffer, stsd, 8, "stsd");
  if (stsdCount === 0) invalid("ISO BMFF stsd has no sample descriptions.");
  const stsdEntries = readBoxes(buffer, stsd.payloadStart + 8, stsd.end);
  if (stsdEntries.length !== stsdCount)
    invalid("ISO BMFF stsd entry count does not match its entries.");

  const sttsCount = readTableCount(buffer, stts, 8, "stts");
  if (stts.end - (stts.payloadStart + 8) !== sttsCount * 8)
    invalid("Invalid ISO BMFF stts table length.");
  let sampleCount = 0;
  let durationSum = 0n;
  for (
    let i = 0, offset = stts.payloadStart + 8;
    i < sttsCount;
    i += 1, offset += 8
  ) {
    const samples = buffer.readUInt32BE(offset);
    const delta = buffer.readUInt32BE(offset + 4);
    if (!samples || !delta)
      invalid("ISO BMFF stts entries must have positive counts and durations.");
    sampleCount += samples;
    durationSum += BigInt(samples) * BigInt(delta);
    if (sampleCount > MAX_TABLE_ENTRIES)
      invalid("ISO BMFF sample count exceeds the parser limit.");
  }
  if (sampleCount === 0 || durationSum !== mediaDuration)
    invalid("ISO BMFF stts does not match the media duration.");

  if (stsz.end - stsz.payloadStart < 12) invalid("Invalid ISO BMFF stsz box.");
  const commonSize = buffer.readUInt32BE(stsz.payloadStart + 4);
  const declaredSamples = buffer.readUInt32BE(stsz.payloadStart + 8);
  if (declaredSamples !== sampleCount || declaredSamples > MAX_TABLE_ENTRIES)
    invalid("ISO BMFF stsz count does not match stts.");
  const sampleSizes: number[] = [];
  if (commonSize === 0) {
    if (stsz.end - (stsz.payloadStart + 12) !== declaredSamples * 4)
      invalid("Invalid ISO BMFF stsz sample sizes.");
    for (
      let i = 0, offset = stsz.payloadStart + 12;
      i < declaredSamples;
      i += 1, offset += 4
    )
      sampleSizes.push(buffer.readUInt32BE(offset));
  } else {
    if (stsz.end !== stsz.payloadStart + 12)
      invalid("Invalid ISO BMFF constant sample size table.");
    for (let i = 0; i < declaredSamples; i += 1) sampleSizes.push(commonSize);
  }
  if (sampleSizes.some((sampleSize) => sampleSize === 0))
    invalid("ISO BMFF video samples must not be empty.");

  const stscCount = readTableCount(buffer, stsc, 8, "stsc");
  if (stscCount === 0 || stsc.end - (stsc.payloadStart + 8) !== stscCount * 12)
    invalid("Invalid ISO BMFF stsc table.");
  const chunkBox = stco ?? co64!;
  const chunkCount = readTableCount(buffer, chunkBox, 8, chunkBox.type);
  const chunkOffsets: bigint[] = [];
  const offsetBytes = chunkBox.type === "co64" ? 8 : 4;
  if (
    chunkBox.end - (chunkBox.payloadStart + 8) !== chunkCount * offsetBytes ||
    chunkCount === 0 ||
    chunkCount > MAX_TABLE_ENTRIES
  )
    invalid("Invalid ISO BMFF chunk offsets.");
  for (
    let i = 0, offset = chunkBox.payloadStart + 8;
    i < chunkCount;
    i += 1, offset += offsetBytes
  ) {
    chunkOffsets.push(
      offsetBytes === 8
        ? buffer.readBigUInt64BE(offset)
        : BigInt(buffer.readUInt32BE(offset)),
    );
  }

  let previousFirstChunk = 0;
  const runs: Array<{ first: number; perChunk: number }> = [];
  for (
    let i = 0, offset = stsc.payloadStart + 8;
    i < stscCount;
    i += 1, offset += 12
  ) {
    const first = buffer.readUInt32BE(offset);
    const perChunk = buffer.readUInt32BE(offset + 4);
    const description = buffer.readUInt32BE(offset + 8);
    if (
      first === 0 ||
      first <= previousFirstChunk ||
      perChunk === 0 ||
      description === 0 ||
      description > stsdCount
    )
      invalid("Invalid ISO BMFF stsc entry.");
    previousFirstChunk = first;
    runs.push({ first, perChunk });
  }
  if (runs[0].first !== 1 || runs[runs.length - 1].first > chunkCount)
    invalid("ISO BMFF stsc does not cover the chunk table.");
  let sampleIndex = 0;
  let runIndex = 0;
  for (let chunk = 1; chunk <= chunkCount; chunk += 1) {
    while (runIndex + 1 < runs.length && runs[runIndex + 1].first <= chunk)
      runIndex += 1;
    const run = runs[runIndex];
    const start = chunkOffsets[chunk - 1];
    let bytes = 0n;
    for (let n = 0; n < run.perChunk; n += 1) {
      if (sampleIndex >= sampleSizes.length)
        invalid("ISO BMFF chunk table contains more samples than stsz.");
      bytes += BigInt(sampleSizes[sampleIndex]);
      sampleIndex += 1;
    }
    const end = start + bytes;
    if (
      !mdats.some(
        (mdat) => start >= BigInt(mdat.payloadStart) && end <= BigInt(mdat.end),
      )
    )
      invalid("ISO BMFF sample chunk points outside mdat payload.");
  }
  if (sampleIndex !== sampleSizes.length)
    invalid("ISO BMFF chunk table does not cover every sample.");
  void track;
  void mdiaScale;
}

function readTableCount(
  buffer: Buffer,
  box: Box,
  minimumSize: number,
  name: string,
): number {
  if (box.end - box.payloadStart < minimumSize)
    invalid(`Invalid ISO BMFF ${name} box.`);
  const count = buffer.readUInt32BE(box.payloadStart + 4);
  if (count > MAX_TABLE_ENTRIES)
    invalid(`ISO BMFF ${name} count exceeds the parser limit.`);
  return count;
}

function parseTrack(buffer: Buffer, track: Box): TrackMetadata {
  const mdiaBoxes = childrenOf(buffer, track).filter(
    (box) => box.type === "mdia",
  );
  if (mdiaBoxes.length !== 1) {
    throw new IsoBmffMetadataError(
      "AMBIGUOUS_METADATA",
      "ISO BMFF track must contain exactly one mdia box.",
    );
  }
  const children = childrenOf(buffer, mdiaBoxes[0]);
  const handlers = children.filter((box) => box.type === "hdlr");
  const headers = children.filter((box) => box.type === "mdhd");
  if (handlers.length !== 1 || headers.length !== 1) {
    throw new IsoBmffMetadataError(
      "AMBIGUOUS_METADATA",
      "ISO BMFF track handler and duration must be unambiguous.",
    );
  }
  return {
    handler: parseHandler(buffer, handlers[0]),
    ...parseMediaHeader(buffer, headers[0]),
    track,
  };
}

/**
 * Validates movie/track timelines and sample-to-mdat structure without decoding
 * codec payloads or establishing that frames are playable.
 */
export function parseIsoBmffVideoMetadata(
  buffer: Buffer,
): IsoBmffVideoMetadata {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16)
    invalid("ISO BMFF input is empty or truncated.");
  const topLevel = readBoxes(buffer, 0, buffer.length);
  if (topLevel[0]?.type !== "ftyp")
    invalid("ISO BMFF ftyp must be the first box.");
  const fileTypes = topLevel.filter((box) => box.type === "ftyp");
  const movieBoxes = topLevel.filter((box) => box.type === "moov");
  if (
    fileTypes.length !== 1 ||
    movieBoxes.length !== 1 ||
    !topLevel.some((box) => box.type === "mdat")
  ) {
    throw new IsoBmffMetadataError(
      "AMBIGUOUS_METADATA",
      "ISO BMFF file type, movie, and media data must be unique and present.",
    );
  }
  if (topLevel.some((box) => box.type === "moof")) {
    throw new IsoBmffMetadataError(
      "FRAGMENTED_MEDIA",
      "Fragmented ISO BMFF media is not supported.",
    );
  }
  const compatibleBrands = parseFileType(buffer, fileTypes[0]);
  const movieChildren = childrenOf(buffer, movieBoxes[0]);
  if (movieChildren.some((box) => box.type === "mvex")) {
    throw new IsoBmffMetadataError(
      "FRAGMENTED_MEDIA",
      "Fragmented ISO BMFF media is not supported.",
    );
  }
  const tracks = movieChildren.filter((box) => box.type === "trak");
  const movieHeaders = movieChildren.filter((box) => box.type === "mvhd");
  if (movieHeaders.length !== 1)
    throw new IsoBmffMetadataError(
      "AMBIGUOUS_METADATA",
      "ISO BMFF movie header must be unique.",
    );
  const movie = parseMovieHeader(buffer, movieHeaders[0]);
  const movieSeconds = Number(movie.durationTicks) / movie.timescale;
  if (!Number.isFinite(movieSeconds))
    throw new IsoBmffMetadataError(
      "INVALID_DURATION",
      "ISO BMFF movie duration is outside the supported range.",
    );
  if (movie.durationTicks > BigInt(movie.timescale) * MAX_REEL_DURATION_SECONDS)
    throw new IsoBmffMetadataError(
      "DURATION_EXCEEDS_LIMIT",
      "Reel video duration must not exceed 90 seconds.",
    );
  const mdats = topLevel.filter((box) => box.type === "mdat");
  if (tracks.length === 0) {
    throw new IsoBmffMetadataError(
      "VIDEO_TRACK_REQUIRED",
      "ISO BMFF file has no media tracks.",
    );
  }
  const videos = tracks
    .map((track) => parseTrack(buffer, track))
    .filter((track) => track.handler === "vide");
  if (videos.length === 0) {
    throw new IsoBmffMetadataError(
      "VIDEO_TRACK_REQUIRED",
      "ISO BMFF file has no video track.",
    );
  }
  if (videos.length !== 1) {
    throw new IsoBmffMetadataError(
      "AMBIGUOUS_METADATA",
      "ISO BMFF file must have exactly one video track.",
    );
  }
  const { durationTicks, timescale, track } = videos[0];
  const mdia = onlyChild(buffer, track, "mdia")!;
  parseSampleTables(buffer, track, mdia, durationTicks, timescale, mdats);
  const editedDuration = parseEditList(buffer, track, durationTicks);
  if (editedDuration !== undefined && editedDuration > movie.durationTicks) {
    throw new IsoBmffMetadataError(
      "INVALID_DURATION",
      "ISO BMFF edit list exceeds the movie timeline.",
    );
  }
  const outputTicks = editedDuration ?? durationTicks;
  const outputScale =
    editedDuration === undefined ? timescale : movie.timescale;
  if (outputTicks > BigInt(outputScale) * MAX_REEL_DURATION_SECONDS) {
    throw new IsoBmffMetadataError(
      "DURATION_EXCEEDS_LIMIT",
      "Reel video duration must not exceed 90 seconds.",
    );
  }
  const durationSeconds = Number(outputTicks) / outputScale;
  if (!Number.isFinite(durationSeconds)) {
    throw new IsoBmffMetadataError(
      "INVALID_DURATION",
      "ISO BMFF media duration is outside the supported range.",
    );
  }
  return {
    durationTicks: outputTicks,
    timescale: outputScale,
    durationSeconds,
    compatibleBrands,
  };
}
