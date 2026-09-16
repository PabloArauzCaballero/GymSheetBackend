import {
  buildExerciseMediaAltText,
  buildExerciseMediaExternalId,
  isOwnStorageUrl,
  isStorableMediaUrl,
  mediaFormatForMime,
} from "./exercise-media-naming";

const exerciseId = "d02730ac-b0cd-4cd3-8570-d3c22b5d8c0f";

describe("buildExerciseMediaExternalId", () => {
  it("sigue la convención del plan: gymsheet:<ejercicio>:<variante>:<formato>:v<versión>", () => {
    expect(
      buildExerciseMediaExternalId({
        exerciseId,
        variant: "HOMBRE",
        mimeType: "video/mp4",
        renderVersion: 1,
      }),
    ).toBe(`gymsheet:${exerciseId}:hombre:mp4:v1`);
  });

  /**
   * La versión forma parte de la identidad: una corrección se sube como render
   * nuevo y crea su propia fila, en vez de pisar la que el socio ya vio.
   */
  it("distingue versiones de render y variantes", () => {
    const first = buildExerciseMediaExternalId({
      exerciseId,
      variant: "MUJER",
      mimeType: "video/webm",
      renderVersion: 1,
    });
    const second = buildExerciseMediaExternalId({
      exerciseId,
      variant: "MUJER",
      mimeType: "video/webm",
      renderVersion: 2,
    });
    expect(first).toBe(`gymsheet:${exerciseId}:mujer:webm:v1`);
    expect(second).not.toBe(first);
  });

  /** La columna admite 180 caracteres; pasarse sería un 500 al insertar. */
  it("nunca supera el largo de la columna", () => {
    const identity = buildExerciseMediaExternalId({
      exerciseId: "x".repeat(300),
      variant: "NEUTRO",
      mimeType: "image/webp",
      renderVersion: 999,
    });
    expect(identity.length).toBeLessThanOrEqual(180);
  });
});

describe("mediaFormatForMime", () => {
  it("traduce los MIME admitidos", () => {
    expect(mediaFormatForMime("video/mp4")).toBe("mp4");
    expect(mediaFormatForMime("video/webm")).toBe("webm");
    expect(mediaFormatForMime("image/webp")).toBe("webp");
    expect(mediaFormatForMime("image/jpeg")).toBe("jpg");
  });

  it("degrada un MIME desconocido a su subtipo saneado, sin romper la carga", () => {
    expect(mediaFormatForMime("video/x-matroska")).toBe("xmatroska");
  });
});

describe("buildExerciseMediaAltText", () => {
  it("usa el catálogo para describir la pieza", () => {
    expect(
      buildExerciseMediaAltText({
        name: "Barbell full squat",
        requiredEquipment: "barbell",
        targetMuscle: "quadriceps",
        variant: "MUJER",
      }),
    ).toBe(
      "Demostración de Barbell full squat con barbell, versión mujer. Trabaja quadriceps.",
    );
  });

  /**
   * Un campo vacío del catálogo se omite en vez de imprimirse: «con null» sería
   * peor que una frase más corta para quien escucha la descripción.
   */
  it("omite el equipo y el músculo cuando el catálogo no los tiene", () => {
    expect(
      buildExerciseMediaAltText({
        name: "Plancha",
        requiredEquipment: null,
        targetMuscle: null,
        variant: "HOMBRE",
      }),
    ).toBe("Demostración de Plancha, versión hombre.");
  });

  it("no supera el largo que admite la columna", () => {
    const text = buildExerciseMediaAltText({
      name: "N".repeat(600),
      requiredEquipment: "barbell",
      targetMuscle: "quadriceps",
      variant: "NEUTRO",
    });
    expect(text.length).toBeLessThanOrEqual(500);
  });
});

describe("isOwnStorageUrl", () => {
  const base = "https://media.gymsheet.test/media";

  it("acepta una URL del propio almacenamiento", () => {
    expect(
      isOwnStorageUrl(`${base}/ejercicios/${exerciseId}/abc.webp`, base),
    ).toBe(true);
  });

  /**
   * Sin esto, una fila nuestra podría apuntar la miniatura a un servidor ajeno
   * y ese tercero vería el tráfico de los socios en cada listado.
   */
  it("rechaza un origen ajeno", () => {
    expect(isOwnStorageUrl("https://otro-servidor.test/x.webp", base)).toBe(
      false,
    );
  });

  it("rechaza otra ruta del mismo dominio", () => {
    expect(
      isOwnStorageUrl("https://media.gymsheet.test/otra-cosa/x.webp", base),
    ).toBe(false);
  });

  it("rechaza lo que no es una URL", () => {
    expect(isOwnStorageUrl("no-es-una-url", base)).toBe(false);
  });
});

/**
 * Réplica de `ck_exercise_media_https`. Si esto y la base se separan, el binario
 * se escribe y la fila falla después, dejando un objeto huérfano para siempre en
 * un almacén inmutable.
 */
describe("isStorableMediaUrl", () => {
  it("acepta HTTPS", () => {
    expect(isStorableMediaUrl("https://media.gymsheet.test/x.mp4")).toBe(true);
  });

  it("rechaza HTTP contra un host público, que es lo que pasa hoy en test", () => {
    expect(
      isStorableMediaUrl(
        "http://gym-media.161.97.85.216.sslip.io/gymsheet-media/x.mp4",
      ),
    ).toBe(false);
  });

  it("acepta HTTP en localhost, que es el desarrollo de todos los días", () => {
    expect(isStorableMediaUrl("http://localhost:3011/media/x.mp4")).toBe(true);
  });

  it("acepta HTTP en 127.0.0.1", () => {
    expect(isStorableMediaUrl("http://127.0.0.1:9000/gymsheet-media/x.mp4")).toBe(
      true,
    );
  });

  /** `localhost.evil.test` no es localhost: la barra tras el host es obligatoria. */
  it("no se deja engañar por un host que empieza por localhost", () => {
    expect(isStorableMediaUrl("http://localhost.evil.test/x.mp4")).toBe(false);
  });
});
