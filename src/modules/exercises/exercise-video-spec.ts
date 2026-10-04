import { z } from "zod";

/**
 * Comprobación previa de una demostración antes de subirla (§1 y §4 del plan).
 *
 * Se valida ANTES de tocar el almacén porque los objetos son inmutables: una
 * pieza mal exportada que llega a MinIO se queda ahí para siempre (ADR-0010) y
 * además deja el catálogo desigual, que es justo lo que el criterio de
 * aceptación quiere evitar. Es más barato rechazar un archivo que convivir con
 * él.
 *
 * La función es pura y recibe el JSON de `ffprobe` ya parseado: ejecutar el
 * binario es responsabilidad del comando, decidir si la pieza vale es
 * responsabilidad de aquí, y así esto se prueba sin ffmpeg instalado.
 */

export const EXERCISE_VIDEO_SPEC = {
  width: 1080,
  height: 1080,
  framesPerSecond: 30,
  durationSeconds: 6,
  /** Margen del recorte: un bucle de 6 s no cae siempre en el fotograma exacto. */
  durationToleranceSeconds: 0.2,
} as const;

/**
 * Lo que se comprueba de una pieza, de forma general. Los renders propios
 * (§1 del plan) son el caso estricto; una biblioteca comprada trae duraciones y
 * tamaños que no controlamos, y se valida con su propio perfil en vez de
 * relajar el de los renders.
 */
export interface ExerciseVideoProfile {
  /** Lados admitidos. La pieza tiene que ser cuadrada y medir uno de ellos. */
  squareSides: readonly number[];
  framesPerSecond: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  /** Cómo se describe la duración esperada en el mensaje de rechazo. */
  durationLabel: string;
}

export const OWN_RENDER_VIDEO_PROFILE: ExerciseVideoProfile = {
  squareSides: [EXERCISE_VIDEO_SPEC.width],
  framesPerSecond: EXERCISE_VIDEO_SPEC.framesPerSecond,
  minDurationSeconds:
    EXERCISE_VIDEO_SPEC.durationSeconds -
    EXERCISE_VIDEO_SPEC.durationToleranceSeconds,
  maxDurationSeconds:
    EXERCISE_VIDEO_SPEC.durationSeconds +
    EXERCISE_VIDEO_SPEC.durationToleranceSeconds,
  durationLabel: `${EXERCISE_VIDEO_SPEC.durationSeconds} s ±${EXERCISE_VIDEO_SPEC.durationToleranceSeconds}`,
};

/**
 * Biblioteca comprada (plan de la biblioteca 2026-10): los GIF de origen son
 * 1080×1080 y los clips recortados de los vídeos verticales quedan en 720×720
 * nativos —reescalarlos solo añadiría peso—. Duran lo que dura el bucle del
 * original, de 5 a 9 s en la práctica.
 */
export const LIBRARY_VIDEO_PROFILE: ExerciseVideoProfile = {
  squareSides: [720, 1080],
  framesPerSecond: 30,
  minDurationSeconds: 3,
  maxDurationSeconds: 15,
  durationLabel: "entre 3 y 15 s",
};

const ffprobeStreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  r_frame_rate: z.string().optional(),
  nb_frames: z.union([z.string(), z.number()]).optional(),
});

const ffprobeReportSchema = z.object({
  streams: z.array(ffprobeStreamSchema).default([]),
  format: z
    .object({
      duration: z.union([z.string(), z.number()]).optional(),
      size: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
});

export type FfprobeReport = z.infer<typeof ffprobeReportSchema>;

/** `"30/1"` → 30. Devuelve nulo si ffprobe no lo informa o el divisor es cero. */
export function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator = "1"] = value.split("/");
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return null;
  }
  return top / bottom;
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ExerciseVideoCheck {
  valid: boolean;
  /** Motivos de rechazo, en español y listos para el log del operador. */
  problems: string[];
  summary: {
    width: number | null;
    height: number | null;
    framesPerSecond: number | null;
    durationSeconds: number | null;
    hasAudio: boolean;
  };
}

/**
 * Compara el informe de ffprobe con la especificación del plan. Acumula TODOS
 * los motivos en vez de parar en el primero: quien recodifica prefiere una
 * lista completa a tres viajes de ida y vuelta.
 */
export function validateExerciseVideo(
  rawReport: unknown,
  profile: ExerciseVideoProfile = OWN_RENDER_VIDEO_PROFILE,
): ExerciseVideoCheck {
  const parsed = ffprobeReportSchema.safeParse(rawReport);
  if (!parsed.success) {
    return {
      valid: false,
      problems: ["El informe de ffprobe no tiene el formato esperado."],
      summary: {
        width: null,
        height: null,
        framesPerSecond: null,
        durationSeconds: null,
        hasAudio: false,
      },
    };
  }

  const report = parsed.data;
  const video = report.streams.find(
    (stream) => stream.codec_type === "video",
  );
  const hasAudio = report.streams.some(
    (stream) => stream.codec_type === "audio",
  );
  const framesPerSecond = parseFrameRate(video?.r_frame_rate);
  const durationSeconds = toNumber(report.format?.duration);
  const problems: string[] = [];

  if (!video) {
    problems.push("El archivo no tiene pista de vídeo.");
  } else {
    if (
      video.width !== video.height ||
      !profile.squareSides.includes(video.width ?? -1)
    ) {
      const expected = profile.squareSides
        .map((side) => `${side}×${side}`)
        .join(" o ");
      problems.push(
        `Resolución ${video.width ?? "?"}×${video.height ?? "?"}; se espera ${expected}.`,
      );
    }
    if (framesPerSecond === null) {
      problems.push("No se pudo leer la cadencia de fotogramas.");
    } else if (
      Math.abs(framesPerSecond - profile.framesPerSecond) > 0.01
    ) {
      problems.push(
        `Cadencia ${framesPerSecond.toFixed(2)} fps; se esperan ${profile.framesPerSecond} fps.`,
      );
    }
  }

  if (durationSeconds === null) {
    problems.push("No se pudo leer la duración.");
  } else if (
    // Un pelo de margen para el redondeo de coma flotante en los bordes.
    durationSeconds < profile.minDurationSeconds - 1e-9 ||
    durationSeconds > profile.maxDurationSeconds + 1e-9
  ) {
    problems.push(
      `Duración ${durationSeconds.toFixed(2)} s; se esperan ${profile.durationLabel}.`,
    );
  }

  // El audio no es un descuido inofensivo: reproducir en bucle una ficha con
  // sonido dentro de un listado es exactamente lo que el criterio prohíbe.
  if (hasAudio) {
    problems.push("El archivo lleva pista de audio; debe exportarse sin audio.");
  }

  return {
    valid: problems.length === 0,
    problems,
    summary: {
      width: video?.width ?? null,
      height: video?.height ?? null,
      framesPerSecond,
      durationSeconds,
      hasAudio,
    },
  };
}
