import {
  ExerciseMediaProvider,
  ExerciseMediaType,
} from "../../common/enums/domain.enums";
import { mediaTargetPrefix } from "../media/media-storage.port";
import {
  mediaProviderForStorage,
  mediaTypeForMime,
} from "./exercise-media.service";
import { uploadExerciseMediaSchema } from "./exercises.schemas";

/**
 * Lo que se fija aquí no es «sube un archivo» —eso pide almacenamiento y base—
 * sino las tres decisiones que, si se tuercen, corrompen el catálogo en
 * silencio: dónde se guarda el objeto, qué tipo de media se registra y qué
 * proveedor queda escrito en la fila.
 */

describe("mediaTargetPrefix para ejercicios", () => {
  const exerciseId = "d02730ac-b0cd-4cd3-8570-d3c22b5d8c0f";

  it("usa una carpeta por ejercicio", () => {
    expect(
      mediaTargetPrefix({ category: "ejercicios", exerciseId }),
    ).toBe(`ejercicios/${exerciseId}`);
  });

  it("no se mezcla con la mediateca administrada", () => {
    expect(mediaTargetPrefix({ category: "catalog" })).toBe("catalog");
  });
});

describe("mediaTypeForMime", () => {
  it("un vídeo es VIDEO", () => {
    expect(mediaTypeForMime("video/mp4")).toBe(ExerciseMediaType.VIDEO);
    expect(mediaTypeForMime("video/webm")).toBe(ExerciseMediaType.VIDEO);
  });

  /** Un GIF es una imagen para el navegador, pero para el catálogo es movimiento. */
  it("un GIF es GIF y no IMAGE", () => {
    expect(mediaTypeForMime("image/gif")).toBe(ExerciseMediaType.GIF);
  });

  it("el resto de imágenes son IMAGE", () => {
    expect(mediaTypeForMime("image/jpeg")).toBe(ExerciseMediaType.IMAGE);
  });
});

describe("mediaProviderForStorage", () => {
  it("MinIO se persiste como S3, que es su protocolo", () => {
    expect(mediaProviderForStorage("minio")).toBe(ExerciseMediaProvider.S3);
    expect(mediaProviderForStorage("s3")).toBe(ExerciseMediaProvider.S3);
  });

  it("distingue local y cloudinary", () => {
    expect(mediaProviderForStorage("local")).toBe(ExerciseMediaProvider.LOCAL);
    expect(mediaProviderForStorage("cloudinary")).toBe(
      ExerciseMediaProvider.CLOUDINARY,
    );
  });
});

describe("uploadExerciseMediaSchema", () => {
  /**
   * Los campos de un formulario multiparte llegan como texto, así que
   * `isPrimary: "true"` tiene que valer lo mismo que `true`. Sin esto, marcar
   * un vídeo como principal desde `curl` no hacía nada y no avisaba.
   */
  it("acepta booleanos y números en texto, como llegan del formulario", () => {
    const parsed = uploadExerciseMediaSchema.parse({
      altText: "Sentadilla trasera con barra, vista lateral",
      variant: "MUJER",
      isPrimary: "true",
      sortOrder: "2",
    });
    expect(parsed.isPrimary).toBe(true);
    expect(parsed.sortOrder).toBe(2);
    expect(parsed.variant).toBe("MUJER");
  });

  it("por defecto no es principal", () => {
    const parsed = uploadExerciseMediaSchema.parse({
      altText: "Lámina del ejercicio",
    });
    expect(parsed.isPrimary).toBe(false);
  });

  /**
   * Sin variante el campo queda sin definir, no en NEUTRO: es lo que permite
   * que volver a subir el mismo archivo conserve la variante ya guardada en vez
   * de degradar una demostración de mujer a neutra. El valor NEUTRO lo pone el
   * servicio solo al crear.
   */
  it("omitir la variante la deja sin definir, no la fuerza a neutra", () => {
    const parsed = uploadExerciseMediaSchema.parse({
      altText: "Lámina del ejercicio",
    });
    expect(parsed.variant).toBeUndefined();
  });

  /** El texto alternativo es obligatorio: un vídeo sin él es invisible para quien no ve. */
  it("exige texto alternativo", () => {
    expect(() => uploadExerciseMediaSchema.parse({})).toThrow();
    expect(() => uploadExerciseMediaSchema.parse({ altText: "ab" })).toThrow();
  });

  it("rechaza una variante inventada", () => {
    expect(() =>
      uploadExerciseMediaSchema.parse({ altText: "Demostración", variant: "OTRO" }),
    ).toThrow();
  });

  /** La URL no se acepta desde fuera: la pone el almacenamiento. */
  it("ignora una URL enviada por quien sube", () => {
    const parsed = uploadExerciseMediaSchema.parse({
      altText: "Demostración",
      url: "https://origen-ajeno.test/video.mp4",
    }) as Record<string, unknown>;
    expect(parsed.url).toBeUndefined();
  });
});
