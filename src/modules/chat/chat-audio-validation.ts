import { BadRequestException } from "@nestjs/common";

const MAX_CHAT_AUDIO_DURATION_MS = 120_000;
const MAX_MP4_BOXES_PER_FILE = 4_096;
const MAX_ESDS_DESCRIPTORS = 64;
const MAX_AUDIO_TABLE_ENTRIES = 100_000;

interface Mp4ParseBudget {
  parsedBoxes: number;
}

interface Mp4Box {
  readonly type: string;
  readonly start: number;
  readonly payloadStart: number;
  readonly end: number;
}

interface Mp4Descriptor {
  readonly tag: number;
  readonly payloadStart: number;
  readonly end: number;
}

/** Validate the supported voice-note container and return its measured duration. */
export function validateChatAudio(buffer: Buffer, mimeType: string): number {
  if (mimeType.toLowerCase() !== "audio/mp4") {
    throw new BadRequestException("El audio debe ser un archivo M4A AAC válido.");
  }

  const budget: Mp4ParseBudget = { parsedBoxes: 0 };
  const topLevel = readBoxes(buffer, 0, buffer.length, budget);
  if (!topLevel.some((box) => box.type === "ftyp")) throw invalidAudio();
  const mdatPayloads = topLevel
    .filter((box) => box.type === "mdat")
    .map((box) => ({ start: box.payloadStart, end: box.end }));
  const moov = topLevel.find((box) => box.type === "moov");
  if (!moov) throw invalidAudio();

  for (const track of readBoxes(buffer, moov.payloadStart, moov.end, budget).filter((box) => box.type === "trak")) {
    const mdia = readBoxes(buffer, track.payloadStart, track.end, budget).find((box) => box.type === "mdia");
    if (!mdia) continue;
    const mdiaBoxes = readBoxes(buffer, mdia.payloadStart, mdia.end, budget);
    const handler = mdiaBoxes.find((box) => box.type === "hdlr");
    if (!handler || readAscii(buffer, handler.payloadStart + 8, handler.end) !== "soun") continue;

    const mdhd = mdiaBoxes.find((box) => box.type === "mdhd");
    const minf = mdiaBoxes.find((box) => box.type === "minf");
    const stbl = minf && readBoxes(buffer, minf.payloadStart, minf.end, budget).find((box) => box.type === "stbl");
    const stblBoxes = stbl ? readBoxes(buffer, stbl.payloadStart, stbl.end, budget) : [];
    const stsd = stblBoxes.find((box) => box.type === "stsd");
    if (!mdhd || !stsd || !hasAacSampleDescription(buffer, stsd, budget) ||
      !hasAacSampleExtents(buffer, stblBoxes, stsd, mdatPayloads)) {
      throw invalidAudio();
    }

    const durationMs = readTrackDurationMs(buffer, mdhd);
    if (durationMs < 1_000 || durationMs > MAX_CHAT_AUDIO_DURATION_MS) throw invalidAudio();
    return durationMs;
  }

  throw invalidAudio();
}

function readTrackDurationMs(buffer: Buffer, mdhd: Mp4Box): number {
  const version = buffer[mdhd.payloadStart];
  if (version === 0) {
    if (mdhd.end - mdhd.payloadStart < 20) throw invalidAudio();
    const timescale = buffer.readUInt32BE(mdhd.payloadStart + 12);
    const duration = buffer.readUInt32BE(mdhd.payloadStart + 16);
    if (timescale === 0) throw invalidAudio();
    return Math.ceil((duration / timescale) * 1000);
  }
  if (version === 1) {
    if (mdhd.end - mdhd.payloadStart < 32) throw invalidAudio();
    const timescale = buffer.readUInt32BE(mdhd.payloadStart + 20);
    const duration = buffer.readBigUInt64BE(mdhd.payloadStart + 24);
    if (timescale === 0) throw invalidAudio();
    return Math.ceil((Number(duration) / timescale) * 1000);
  }
  throw invalidAudio();
}

function hasAacSampleDescription(buffer: Buffer, stsd: Mp4Box, budget: Mp4ParseBudget): boolean {
  if (stsd.end - stsd.payloadStart < 8) return false;
  const entryCount = buffer.readUInt32BE(stsd.payloadStart + 4);
  if (entryCount < 1 || entryCount > MAX_AUDIO_TABLE_ENTRIES) return false;
  const entries = readBoxes(buffer, stsd.payloadStart + 8, stsd.end, budget);
  return entries.length === entryCount && entries.every((entry) =>
    entry.type === "mp4a" && hasAacLcDecoderConfig(buffer, entry, budget),
  );
}

function hasAacLcDecoderConfig(buffer: Buffer, sampleEntry: Mp4Box, budget: Mp4ParseBudget): boolean {
  // AudioSampleEntry version 0 has a 28-byte fixed payload before child boxes.
  if (sampleEntry.end - sampleEntry.payloadStart < 28) return false;
  if (buffer.readUInt16BE(sampleEntry.payloadStart + 8) !== 0) return false;
  const children = readBoxes(buffer, sampleEntry.payloadStart + 28, sampleEntry.end, budget);
  const esds = children.find((box) => box.type === "esds");
  if (!esds || esds.end - esds.payloadStart < 4 || buffer[esds.payloadStart] !== 0) return false;

  const esDescriptors = readDescriptors(buffer, esds.payloadStart + 4, esds.end);
  for (const esDescriptor of esDescriptors) {
    if (esDescriptor.tag !== 0x03 || esDescriptor.end - esDescriptor.payloadStart < 3) continue;
    const flags = buffer[esDescriptor.payloadStart + 2];
    let childOffset = esDescriptor.payloadStart + 3;
    if (flags & 0x80) childOffset += 2;
    if (flags & 0x40) {
      if (childOffset >= esDescriptor.end) throw invalidAudio();
      childOffset += 1 + buffer[childOffset];
    }
    if (flags & 0x20) childOffset += 2;
    if (childOffset > esDescriptor.end) throw invalidAudio();

    const esChildren = readDescriptors(buffer, childOffset, esDescriptor.end);
    for (const decoderConfig of esChildren) {
      if (decoderConfig.tag !== 0x04) continue;
      if (decoderConfig.end - decoderConfig.payloadStart < 13) throw invalidAudio();
      const objectTypeIndication = buffer[decoderConfig.payloadStart];
      const streamType = buffer[decoderConfig.payloadStart + 1];
      // streamType(6) · upStream(1) · reserved(1). El bit reservado NO se
      // exige: los codificadores de Apple (AVAudioRecorder, CoreAudio) lo
      // escriben a 0 (0x14) y exigirlo rechazaba toda nota de voz de un iPhone.
      if (objectTypeIndication !== 0x40 || ((streamType >> 2) & 0x3f) !== 5) continue;

      const decoderSpecificInfos = readDescriptors(buffer, decoderConfig.payloadStart + 13, decoderConfig.end);
      if (decoderSpecificInfos.some((descriptor) =>
        descriptor.tag === 0x05 && isAacLcAudioSpecificConfig(buffer, descriptor),
      )) return true;
    }
  }
  return false;
}

function isAacLcAudioSpecificConfig(buffer: Buffer, descriptor: Mp4Descriptor): boolean {
  if (descriptor.end - descriptor.payloadStart < 2) return false;
  const firstByte = buffer[descriptor.payloadStart];
  const audioObjectType = firstByte >> 3;
  if (audioObjectType !== 2) return false;
  const secondByte = buffer[descriptor.payloadStart + 1];
  const samplingFrequencyIndex = ((firstByte & 0x07) << 1) | (secondByte >> 7);
  const channelConfiguration = (secondByte >> 3) & 0x0f;
  // This contract accepts only standard frequency indexes (0–12) and channel
  // configurations (1–7). Explicit rates, reserved indexes, and PCE layouts
  // need additional parsing and are deliberately rejected.
  return samplingFrequencyIndex <= 12 && channelConfiguration >= 1 && channelConfiguration <= 7;
}

function readDescriptors(buffer: Buffer, start: number, end: number): Mp4Descriptor[] {
  if (start < 0 || end > buffer.length || start > end) throw invalidAudio();
  const descriptors: Mp4Descriptor[] = [];
  let offset = start;
  while (offset < end) {
    if (descriptors.length >= MAX_ESDS_DESCRIPTORS || offset >= end) throw invalidAudio();
    const tag = buffer[offset];
    let cursor = offset + 1;
    let descriptorLength = 0;
    let hasLastLengthByte = false;
    for (let index = 0; index < 4; index += 1) {
      if (cursor >= end) throw invalidAudio();
      const lengthByte = buffer[cursor];
      cursor += 1;
      descriptorLength = descriptorLength * 128 + (lengthByte & 0x7f);
      if ((lengthByte & 0x80) === 0) {
        hasLastLengthByte = true;
        break;
      }
    }
    if (!hasLastLengthByte || descriptorLength > end - cursor) throw invalidAudio();
    const descriptorEnd = cursor + descriptorLength;
    descriptors.push({ tag, payloadStart: cursor, end: descriptorEnd });
    offset = descriptorEnd;
  }
  return descriptors;
}

interface StscEntry {
  readonly firstChunk: number;
  readonly samplesPerChunk: number;
  readonly sampleDescriptionIndex: number;
}

export interface AudioDataExtent {
  readonly start: number;
  readonly end: number;
}

export interface SampleExtentContainmentResult {
  readonly contained: boolean;
  /** Number of comparisons/advances in the linear sweep, excluding sorting. */
  readonly sweepSteps: number;
}

/** Sort bounded intervals once, then check membership in a single linear sweep. */
export function checkSampleExtentsContained(
  sampleExtents: readonly AudioDataExtent[],
  mdatPayloads: readonly AudioDataExtent[],
): SampleExtentContainmentResult {
  const orderedSamples = [...sampleExtents].sort((left, right) => left.start - right.start || left.end - right.end);
  const orderedMdats = [...mdatPayloads].sort((left, right) => left.start - right.start || left.end - right.end);
  let mdatIndex = 0;
  let sweepSteps = 0;

  for (const sample of orderedSamples) {
    if (!Number.isSafeInteger(sample.start) || !Number.isSafeInteger(sample.end) || sample.start < 0 || sample.end <= sample.start) {
      return { contained: false, sweepSteps };
    }
    while (mdatIndex < orderedMdats.length && orderedMdats[mdatIndex].end <= sample.start) {
      mdatIndex += 1;
      sweepSteps += 1;
    }
    sweepSteps += 1;
    const mdat = orderedMdats[mdatIndex];
    if (!mdat || sample.start < mdat.start || sample.end > mdat.end) {
      return { contained: false, sweepSteps };
    }
  }
  return { contained: true, sweepSteps };
}

function hasAacSampleExtents(
  buffer: Buffer,
  stblBoxes: readonly Mp4Box[],
  stsd: Mp4Box,
  mdatPayloads: readonly AudioDataExtent[],
): boolean {
  const stsz = stblBoxes.find((box) => box.type === "stsz");
  const stsc = stblBoxes.find((box) => box.type === "stsc");
  const stco = stblBoxes.find((box) => box.type === "stco");
  const co64 = stblBoxes.find((box) => box.type === "co64");
  if (!stsz || !stsc || Boolean(stco) === Boolean(co64) || mdatPayloads.length === 0) return false;

  const sampleSizes = readSampleSizes(buffer, stsz);
  const chunkOffsets = readChunkOffsets(buffer, stco ?? co64);
  const stscEntries = readStscEntries(buffer, stsc, buffer.readUInt32BE(stsd.payloadStart + 4));
  if (!sampleSizes || !chunkOffsets || !stscEntries || stscEntries.length > chunkOffsets.length) return false;
  if (stscEntries[0]?.firstChunk !== 1 || stscEntries.some((entry) => entry.firstChunk > chunkOffsets.length)) return false;

  let stscIndex = 0;
  let sampleIndex = 0;
  const sampleExtents: AudioDataExtent[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkOffsets.length; chunkIndex += 1) {
    const oneBasedChunkIndex = chunkIndex + 1;
    while (stscIndex + 1 < stscEntries.length && stscEntries[stscIndex + 1].firstChunk <= oneBasedChunkIndex) {
      stscIndex += 1;
    }
    const stscEntry = stscEntries[stscIndex];
    if (stscEntry.sampleDescriptionIndex > buffer.readUInt32BE(stsd.payloadStart + 4)) return false;
    const sampleEnd = sampleIndex + stscEntry.samplesPerChunk;
    if (sampleEnd > sampleSizes.length) return false;

    let chunkSize = 0;
    for (; sampleIndex < sampleEnd; sampleIndex += 1) {
      const sampleSize = sampleSizes[sampleIndex];
      if (sampleSize <= 0 || chunkSize > Number.MAX_SAFE_INTEGER - sampleSize) return false;
      chunkSize += sampleSize;
    }

    const chunkOffset = chunkOffsets[chunkIndex];
    if (chunkOffset > Number.MAX_SAFE_INTEGER - chunkSize) return false;
    const chunkEnd = chunkOffset + chunkSize;
    sampleExtents.push({ start: chunkOffset, end: chunkEnd });
  }
  return sampleIndex === sampleSizes.length && checkSampleExtentsContained(sampleExtents, mdatPayloads).contained;
}

function readSampleSizes(buffer: Buffer, stsz: Mp4Box): number[] | undefined {
  if (stsz.end - stsz.payloadStart < 12) return undefined;
  const sampleSize = buffer.readUInt32BE(stsz.payloadStart + 4);
  const sampleCount = buffer.readUInt32BE(stsz.payloadStart + 8);
  if (sampleCount === 0 || sampleCount > MAX_AUDIO_TABLE_ENTRIES) return undefined;
  if (sampleSize > 0) return Array(sampleCount).fill(sampleSize) as number[];
  if (stsz.end - (stsz.payloadStart + 12) !== sampleCount * 4) return undefined;
  const sizes: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const size = buffer.readUInt32BE(stsz.payloadStart + 12 + index * 4);
    if (size === 0) return undefined;
    sizes.push(size);
  }
  return sizes;
}

function readChunkOffsets(buffer: Buffer, box: Mp4Box | undefined): number[] | undefined {
  if (!box || box.end - box.payloadStart < 8) return undefined;
  const count = buffer.readUInt32BE(box.payloadStart + 4);
  const entrySize = box.type === "stco" ? 4 : 8;
  if (count === 0 || count > MAX_AUDIO_TABLE_ENTRIES || box.end - (box.payloadStart + 8) !== count * entrySize) {
    return undefined;
  }
  const offsets: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (entrySize === 4) {
      offsets.push(buffer.readUInt32BE(box.payloadStart + 8 + index * entrySize));
      continue;
    }
    const offset = buffer.readBigUInt64BE(box.payloadStart + 8 + index * entrySize);
    if (offset > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    offsets.push(Number(offset));
  }
  return offsets;
}

function readStscEntries(buffer: Buffer, box: Mp4Box, sampleDescriptionCount: number): StscEntry[] | undefined {
  if (box.end - box.payloadStart < 8) return undefined;
  const count = buffer.readUInt32BE(box.payloadStart + 4);
  if (count === 0 || count > MAX_AUDIO_TABLE_ENTRIES || box.end - (box.payloadStart + 8) !== count * 12) {
    return undefined;
  }
  const entries: StscEntry[] = [];
  let previousFirstChunk = 0;
  for (let index = 0; index < count; index += 1) {
    const entryOffset = box.payloadStart + 8 + index * 12;
    const firstChunk = buffer.readUInt32BE(entryOffset);
    const samplesPerChunk = buffer.readUInt32BE(entryOffset + 4);
    const sampleDescriptionIndex = buffer.readUInt32BE(entryOffset + 8);
    if (firstChunk <= previousFirstChunk || samplesPerChunk === 0 || sampleDescriptionIndex === 0 ||
      sampleDescriptionIndex > sampleDescriptionCount) return undefined;
    previousFirstChunk = firstChunk;
    entries.push({ firstChunk, samplesPerChunk, sampleDescriptionIndex });
  }
  return entries;
}

function readBoxes(buffer: Buffer, start: number, end: number, budget: Mp4ParseBudget): Mp4Box[] {
  if (start < 0 || end > buffer.length || start > end) throw invalidAudio();
  const boxes: Mp4Box[] = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) throw invalidAudio();
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    let boxSize = size32;
    if (size32 === 1) {
      if (end - offset < 16) throw invalidAudio();
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidAudio();
      boxSize = Number(extended);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = end - offset;
    }
    if (boxSize < headerSize || offset + boxSize > end) throw invalidAudio();
    if (budget.parsedBoxes >= MAX_MP4_BOXES_PER_FILE) throw invalidAudio();
    budget.parsedBoxes += 1;
    boxes.push({ type, start: offset, payloadStart: offset + headerSize, end: offset + boxSize });
    offset += boxSize;
  }
  return boxes;
}

function readAscii(buffer: Buffer, start: number, end: number): string {
  if (start < 0 || start + 4 > end) throw invalidAudio();
  return buffer.toString("ascii", start, start + 4);
}

function invalidAudio(): BadRequestException {
  return new BadRequestException("El audio debe ser un archivo M4A AAC válido de hasta 120 segundos.");
}
