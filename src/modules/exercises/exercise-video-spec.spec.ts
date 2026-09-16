import {
  EXERCISE_VIDEO_SPEC,
  parseFrameRate,
  validateExerciseVideo,
} from "./exercise-video-spec";

/**
 * Los informes de abajo son salida REAL de `ffprobe 9.0.1` sobre archivos
 * generados con ffmpeg para esta prueba (1080×1080/30 fps/6 s y sus variantes
 * defectuosas). No son JSON inventado: si ffprobe cambia el formato, esta
 * prueba deja de reflejar la realidad y hay que regenerarlos con
 *
 *   ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames \
 *           -show_entries format=duration,size -of json <archivo>
 */
const VALID_REPORT = {
  programs: [],
  stream_groups: [],
  streams: [
    {
      codec_name: "h264",
      codec_type: "video",
      width: 1080,
      height: 1080,
      r_frame_rate: "30/1",
      nb_frames: "180",
    },
  ],
  format: { duration: "6.000000", size: "336533" },
};

const REPORT_720 = {
  programs: [],
  stream_groups: [],
  streams: [
    {
      codec_name: "h264",
      codec_type: "video",
      width: 720,
      height: 720,
      r_frame_rate: "30/1",
      nb_frames: "180",
    },
  ],
  format: { duration: "6.000000", size: "67265" },
};

const REPORT_24_FPS = {
  programs: [],
  stream_groups: [],
  streams: [
    {
      codec_name: "h264",
      codec_type: "video",
      width: 1080,
      height: 1080,
      r_frame_rate: "24/1",
      nb_frames: "144",
    },
  ],
  format: { duration: "6.000000", size: "97452" },
};

const REPORT_4_SECONDS = {
  programs: [],
  stream_groups: [],
  streams: [
    {
      codec_name: "h264",
      codec_type: "video",
      width: 1080,
      height: 1080,
      r_frame_rate: "30/1",
      nb_frames: "120",
    },
  ],
  format: { duration: "4.000000", size: "76934" },
};

const REPORT_WITH_AUDIO = {
  programs: [],
  stream_groups: [],
  streams: [
    {
      codec_name: "h264",
      codec_type: "video",
      width: 1080,
      height: 1080,
      r_frame_rate: "30/1",
      nb_frames: "180",
    },
    { codec_name: "aac", codec_type: "audio", r_frame_rate: "0/0", nb_frames: "260" },
  ],
  format: { duration: "6.000000", size: "164972" },
};

describe("parseFrameRate", () => {
  it("lee la fracción que informa ffprobe", () => {
    expect(parseFrameRate("30/1")).toBe(30);
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
  });

  /** La pista de audio llega con `0/0`; dividir por cero daría Infinity. */
  it("devuelve nulo ante un divisor cero o un valor ausente", () => {
    expect(parseFrameRate("0/0")).toBeNull();
    expect(parseFrameRate(undefined)).toBeNull();
  });
});

describe("validateExerciseVideo", () => {
  it("acepta una pieza que cumple la especificación", () => {
    const check = validateExerciseVideo(VALID_REPORT);
    expect(check.valid).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.summary).toEqual({
      width: EXERCISE_VIDEO_SPEC.width,
      height: EXERCISE_VIDEO_SPEC.height,
      framesPerSecond: EXERCISE_VIDEO_SPEC.framesPerSecond,
      durationSeconds: EXERCISE_VIDEO_SPEC.durationSeconds,
      hasAudio: false,
    });
  });

  it("rechaza una resolución distinta de 1080×1080", () => {
    const check = validateExerciseVideo(REPORT_720);
    expect(check.valid).toBe(false);
    expect(check.problems.join(" ")).toContain("720×720");
  });

  it("rechaza una cadencia distinta de 30 fps", () => {
    const check = validateExerciseVideo(REPORT_24_FPS);
    expect(check.valid).toBe(false);
    expect(check.problems.join(" ")).toContain("24.00 fps");
  });

  it("rechaza una duración fuera del margen de 6 s", () => {
    const check = validateExerciseVideo(REPORT_4_SECONDS);
    expect(check.valid).toBe(false);
    expect(check.problems.join(" ")).toContain("4.00 s");
  });

  /** Una ficha que suena sola dentro de un listado es exactamente lo prohibido. */
  it("rechaza una pieza con pista de audio", () => {
    const check = validateExerciseVideo(REPORT_WITH_AUDIO);
    expect(check.valid).toBe(false);
    expect(check.summary.hasAudio).toBe(true);
    expect(check.problems.join(" ")).toContain("audio");
  });

  it("acumula todos los motivos en vez de parar en el primero", () => {
    const check = validateExerciseVideo({
      streams: [
        {
          codec_type: "video",
          width: 720,
          height: 720,
          r_frame_rate: "24/1",
        },
        { codec_type: "audio", r_frame_rate: "0/0" },
      ],
      format: { duration: "3.000000" },
    });
    expect(check.problems).toHaveLength(4);
  });

  it("rechaza un archivo sin pista de vídeo", () => {
    const check = validateExerciseVideo({
      streams: [{ codec_type: "audio", r_frame_rate: "0/0" }],
      format: { duration: "6.000000" },
    });
    expect(check.valid).toBe(false);
    expect(check.problems.join(" ")).toContain("no tiene pista de vídeo");
  });

  it("rechaza un informe que no tiene la forma esperada", () => {
    const check = validateExerciseVideo({ streams: "no es una lista" });
    expect(check.valid).toBe(false);
    expect(check.problems.join(" ")).toContain("formato esperado");
  });

  /** El margen existe porque un corte de 6 s no cae siempre en el fotograma exacto. */
  it("tolera la desviación declarada en la especificación", () => {
    const check = validateExerciseVideo({
      ...VALID_REPORT,
      format: { duration: "6.150000", size: "336533" },
    });
    expect(check.valid).toBe(true);
  });
});
