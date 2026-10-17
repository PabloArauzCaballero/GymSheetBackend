import { readFileSync } from "fs";
import { join } from "path";
import { BadRequestException } from "@nestjs/common";
import { resolveMediaExtension } from "../media/adapters/mime-extension";
import { checkSampleExtentsContained, validateChatAudio } from "./chat-audio-validation";

const audio = readFileSync(join(__dirname, "fixtures/valid-audio.m4a"));

describe("validateChatAudio", () => {
  it("accepts an AAC M4A and returns its measured duration", () => {
    const durationMs = validateChatAudio(audio, "audio/mp4");

    expect(durationMs).toBeGreaterThanOrEqual(1000);
    expect(durationMs).toBeLessThanOrEqual(2000);
  });

  it("accepts a voice note encoded by Apple CoreAudio, whose esds leaves the reserved bit at 0", () => {
    // Producido con `afconvert -f m4af -d aac`, el mismo motor que usa
    // AVAudioRecorder en el iPhone: DecoderConfigDescriptor.streamType = 0x14.
    const apple = readFileSync(join(__dirname, "fixtures/apple-coreaudio.m4a"));
    expect(apple.includes(Buffer.from([0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14]))).toBe(true);

    const durationMs = validateChatAudio(apple, "audio/mp4");

    expect(durationMs).toBeGreaterThanOrEqual(1000);
    expect(durationMs).toBeLessThanOrEqual(10_000);
  });

  it("still rejects a decoder config whose stream type is not audio", () => {
    const apple = Buffer.from(readFileSync(join(__dirname, "fixtures/apple-coreaudio.m4a")));
    const at = apple.indexOf(Buffer.from([0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14]));
    apple[at + 6] = 0x10; // streamType 4 (visual), no audio (5)

    expect(() => validateChatAudio(apple, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects a MIME type that is not the supported AAC M4A format", () => {
    expect(() => validateChatAudio(audio, "audio/webm")).toThrow(BadRequestException);
  });

  it("rejects an MP4 audio track longer than 120 seconds", () => {
    const tooLong = Buffer.from(audio);
    const mdhdType = tooLong.indexOf(Buffer.from("mdhd"));
    expect(mdhdType).toBeGreaterThan(0);
    const mdhdStart = mdhdType - 4;
    const version = tooLong[mdhdType + 4] >> 7;
    expect(version).toBe(0);
    const timescale = tooLong.readUInt32BE(mdhdStart + 20);
    tooLong.writeUInt32BE(timescale * 121, mdhdStart + 24);

    expect(() => validateChatAudio(tooLong, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an audio track shorter than one second", () => {
    const tooShort = Buffer.from(audio);
    const mdhdType = tooShort.indexOf(Buffer.from("mdhd"));
    const mdhdStart = mdhdType - 4;
    const timescale = tooShort.readUInt32BE(mdhdStart + 20);
    tooShort.writeUInt32BE(Math.floor(timescale * 0.999), mdhdStart + 24);

    expect(() => validateChatAudio(tooShort, "audio/mp4")).toThrow(BadRequestException);
  });

  it("stores the supported audio MIME with an M4A extension", () => {
    expect(resolveMediaExtension("audio/mp4")).toBe(".m4a");
  });

  it("rejects malformed data and an MP4 with no audio track", () => {
    expect(() => validateChatAudio(Buffer.from("not audio"), "audio/mp4")).toThrow(BadRequestException);
    const video = Buffer.from(audio);
    const handlerType = video.indexOf(Buffer.from("soun"));
    expect(handlerType).toBeGreaterThan(0);
    video.write("vide", handlerType, "ascii");
    expect(() => validateChatAudio(video, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an audio track whose sample table contains no encoded frames", () => {
    const emptyTrack = Buffer.from(audio);
    const stszType = emptyTrack.indexOf(Buffer.from("stsz"));
    expect(stszType).toBeGreaterThan(0);
    emptyTrack.writeUInt32BE(0, stszType + 12);

    expect(() => validateChatAudio(emptyTrack, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects a positive sample count when every variable sample size is zero", () => {
    const zeroSizedSamples = Buffer.from(audio);
    const stszType = zeroSizedSamples.indexOf(Buffer.from("stsz"));
    const sampleCount = 66;
    zeroSizedSamples.writeUInt32BE(0, stszType + 8);
    zeroSizedSamples.writeUInt32BE(sampleCount, stszType + 12);
    for (let index = 0; index < sampleCount; index += 1) {
      zeroSizedSamples.writeUInt32BE(0, stszType + 16 + index * 4);
    }

    expect(() => validateChatAudio(zeroSizedSamples, "audio/mp4")).toThrow(BadRequestException);
  });

  it("requires an esds decoder configuration in the mp4a sample entry", () => {
    const missingEsds = Buffer.from(audio);
    const esdsType = missingEsds.indexOf(Buffer.from("esds"));
    expect(esdsType).toBeGreaterThan(0);
    missingEsds.write("free", esdsType, "ascii");

    expect(() => validateChatAudio(missingEsds, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an esds AudioSpecificConfig whose AudioObjectType is not AAC-LC", () => {
    const wrongAudioObjectType = Buffer.from(audio);
    const audioSpecificConfig = Buffer.from([0x12, 0x08, 0x56, 0xe5, 0x00]);
    const configOffset = wrongAudioObjectType.indexOf(audioSpecificConfig);
    expect(configOffset).toBeGreaterThan(0);
    wrongAudioObjectType[configOffset] = 0x1a;

    expect(() => validateChatAudio(wrongAudioObjectType, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an esds descriptor length that crosses the enclosing box boundary", () => {
    const invalidDescriptorLength = Buffer.from(audio);
    const esdsType = invalidDescriptorLength.indexOf(Buffer.from("esds"));
    const esDescriptorLengthEnd = esdsType + 12;
    invalidDescriptorLength[esDescriptorLengthEnd] = 0x7f;

    expect(() => validateChatAudio(invalidDescriptorLength, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an esds child box whose declared size crosses the mp4a sample-entry boundary", () => {
    const invalidEsdsBoxSize = Buffer.from(audio);
    const esdsType = invalidEsdsBoxSize.indexOf(Buffer.from("esds"));
    invalidEsdsBoxSize.writeUInt32BE(0xffffffff, esdsType - 4);

    expect(() => validateChatAudio(invalidEsdsBoxSize, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an AAC-LC AudioSpecificConfig with explicit sampling frequency", () => {
    const explicitFrequency = mutateAudioSpecificConfig((config) => {
      config[0] = (config[0] & 0xf8) | 0x07;
      config[1] |= 0x80;
    });

    expect(() => validateChatAudio(explicitFrequency, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects reserved sampling frequency index 13", () => {
    const reservedFrequency = mutateAudioSpecificConfig((config) => {
      config[0] = (config[0] & 0xf8) | 0x06;
      config[1] |= 0x80;
    });

    expect(() => validateChatAudio(reservedFrequency, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects channel configuration zero when it would require an unparsed PCE", () => {
    const programConfigElement = mutateAudioSpecificConfig((config) => {
      config[1] &= 0x87;
    });

    expect(() => validateChatAudio(programConfigElement, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects an AudioSpecificConfig truncated to one byte", () => {
    const truncatedConfig = Buffer.from(audio);
    const dsiType = truncatedConfig.indexOf(Buffer.from("\x05\x80\x80\x80\x05", "binary"));
    expect(dsiType).toBeGreaterThan(0);
    truncatedConfig[dsiType + 4] = 0x01;

    expect(() => validateChatAudio(truncatedConfig, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects AAC sample metadata when the file has no mdat payload box", () => {
    const missingMdat = Buffer.from(audio);
    const mdatType = missingMdat.indexOf(Buffer.from("mdat"));
    expect(mdatType).toBeGreaterThan(0);
    missingMdat.write("free", mdatType, "ascii");

    expect(() => validateChatAudio(missingMdat, "audio/mp4")).toThrow(BadRequestException);
  });

  it("rejects a chunk offset whose AAC sample extent lies outside every mdat payload", () => {
    const outOfRangeChunk = Buffer.from(audio);
    const stcoType = outOfRangeChunk.indexOf(Buffer.from("stco"));
    expect(stcoType).toBeGreaterThan(0);
    outOfRangeChunk.writeUInt32BE(outOfRangeChunk.length + 1, stcoType + 12);

    expect(() => validateChatAudio(outOfRangeChunk, "audio/mp4")).toThrow(BadRequestException);
  });

  it("checks many out-of-order sample extents within a deterministic linear sweep bound", () => {
    const mdatCount = 4_096;
    const chunkCount = 100_000;
    const mdatPayloads = Array.from({ length: mdatCount }, (_, index) => ({
      start: index * 1_000,
      end: index * 1_000 + 100,
    }));
    const sampleExtents = Array.from({ length: chunkCount }, (_, index) => {
      const mdat = mdatPayloads[index % mdatPayloads.length];
      return { start: mdat.start + 10, end: mdat.start + 11 };
    }).reverse();

    const result = checkSampleExtentsContained(sampleExtents, mdatPayloads);

    expect(result.contained).toBe(true);
    expect(result.sweepSteps).toBeLessThanOrEqual(chunkCount + mdatCount);
  });

  it("rejects an MP4 that exceeds the total box parse budget before reaching its valid audio boxes", () => {
    const harmlessFreeBox = Buffer.from([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]);
    const manyFreeBoxes = Buffer.alloc(harmlessFreeBox.length * 10_000);
    for (let offset = 0; offset < manyFreeBoxes.length; offset += harmlessFreeBox.length) {
      harmlessFreeBox.copy(manyFreeBoxes, offset);
    }
    const oversizedBoxCount = Buffer.concat([manyFreeBoxes, audio]);

    expect(() => validateChatAudio(oversizedBoxCount, "audio/mp4")).toThrow(BadRequestException);
  });
});

function mutateAudioSpecificConfig(mutate: (config: Buffer) => void): Buffer {
  const result = Buffer.from(audio);
  const originalConfig = Buffer.from([0x12, 0x08, 0x56, 0xe5, 0x00]);
  const configOffset = result.indexOf(originalConfig);
  expect(configOffset).toBeGreaterThan(0);
  mutate(result.subarray(configOffset, configOffset + originalConfig.length));
  return result;
}
