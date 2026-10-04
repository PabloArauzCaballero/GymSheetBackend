import {
  LibraryImportState,
  LibraryManifest,
  libraryEntryVersion,
  libraryManifestSchema,
  mediaIdentity,
  planLibraryImport,
} from "./exercise-library-manifest";

const SHA = {
  video: "a".repeat(64),
  poster: "b".repeat(64),
  clip: "c".repeat(64),
  clipPoster: "d".repeat(64),
  source: "e".repeat(64),
};

const exercise = {
  name: "Sentadilla búlgara con salto",
  muscleGroup: "quadriceps",
  description: "Sentadilla a una pierna con el pie trasero apoyado y salto explosivo.",
  bodyPart: "upper legs",
  requiredEquipment: "bench",
  targetMuscle: "quads",
  secondaryMuscles: ["glutes", "hamstrings"],
  instructionSteps: [
    "Apoya el empeine del pie trasero en el banco.",
    "Baja hasta que el muslo delantero quede paralelo al suelo.",
    "Salta con fuerza y aterriza suave en la misma posición.",
  ],
  names: {
    es: "Sentadilla búlgara con salto",
    pt: "Agachamento búlgaro com salto",
    en: "bulgarian split squat jump",
  },
  modality: "pliometria",
} as const;

function video(overrides: Record<string, unknown> = {}) {
  return {
    kind: "VIDEO",
    file: "procesado/bib-pliometria-sentadilla-bulgara-con-salto/hombre.mp4",
    sha256: SHA.video,
    poster: {
      file: "procesado/bib-pliometria-sentadilla-bulgara-con-salto/hombre-poster.webp",
      sha256: SHA.poster,
    },
    variant: "HOMBRE",
    durationMs: 6000,
    brandingVisible: false,
    source: { folder: "hiit", file: "Agachamento búlgaro com salto.gif", sha256: SHA.source },
    ...overrides,
  };
}

function manifestWith(entries: unknown[]): LibraryManifest {
  return libraryManifestSchema.parse({
    library: "biblioteca-2026-10",
    license: "Licencia comercial adquirida por GymSheet",
    attribution: "Biblioteca comprada por el propietario",
    entries,
  });
}

const createEntry = {
  decision: "CREATE",
  key: "bib:pliometria:sentadilla-bulgara-con-salto",
  exercise,
  media: [video()],
};

/** Estado con todos los archivos presentes y correctos, y nada cargado aún. */
function cleanState(overrides: Partial<LibraryImportState> = {}): LibraryImportState {
  const files = new Map<string, string | null>([
    ["procesado/bib-pliometria-sentadilla-bulgara-con-salto/hombre.mp4", SHA.video],
    ["procesado/bib-pliometria-sentadilla-bulgara-con-salto/hombre-poster.webp", SHA.poster],
    ["procesado/clip/hombre.mp4", SHA.clip],
    ["procesado/clip/hombre-poster.webp", SHA.clipPoster],
  ]);
  return {
    fileChecksums: files,
    videoProblems: new Map(),
    fileSizes: new Map([...files.keys()].map((file) => [file, 1_000_000])),
    maxBytes: 50 * 1024 * 1024,
    createdExercises: new Map(),
    linkTargets: new Map([["0123", { id: "target-id", activeMediaCount: 1 }]]),
    foreignCustomNames: new Set(),
    existingMedia: new Map(),
    ...overrides,
  };
}

describe("libraryManifestSchema", () => {
  it("rechaza un vídeo sin póster: la lista reproduciría el vídeo entero", () => {
    const result = libraryManifestSchema.safeParse({
      library: "biblioteca-2026-10",
      license: "Licencia",
      attribution: "Autor",
      entries: [{ ...createEntry, media: [video({ poster: null })] }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza rutas que salen de la carpeta de la entrega", () => {
    const result = libraryManifestSchema.safeParse({
      library: "biblioteca-2026-10",
      license: "Licencia",
      attribution: "Autor",
      entries: [{ ...createEntry, media: [video({ file: "../../etc/passwd.mp4" })] }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un músculo fuera del vocabulario del enriquecimiento", () => {
    const result = libraryManifestSchema.safeParse({
      library: "biblioteca-2026-10",
      license: "Licencia",
      attribution: "Autor",
      entries: [{ ...createEntry, exercise: { ...exercise, targetMuscle: "cuádriceps" } }],
    });
    expect(result.success).toBe(false);
  });
});

describe("planLibraryImport", () => {
  it("crea el ejercicio y sube su vídeo como principal en una carga limpia", () => {
    const plan = planLibraryImport(manifestWith([createEntry]), cleanState());
    expect(plan.problems).toEqual([]);
    expect(plan.counts).toMatchObject({ createExercises: 1, uploadMedia: 1 });
    expect(plan.media[0]).toMatchObject({ type: "UPLOAD", isPrimary: true, mimeType: "video/mp4" });
  });

  it("no toca nada en la segunda pasada: misma versión y mismo contenido", () => {
    const manifest = manifestWith([createEntry]);
    const entry = manifest.entries[0];
    if (entry.decision !== "CREATE") throw new Error("se esperaba CREATE");
    const plan = planLibraryImport(
      manifest,
      cleanState({
        createdExercises: new Map([
          [entry.key, { id: "ex-1", externalVersion: libraryEntryVersion(entry), activeMediaCount: 1 }],
        ]),
        existingMedia: new Map([
          [
            mediaIdentity("ex-1", "HOMBRE", "video/mp4"),
            { checksumSha256: SHA.video, active: true, hasThumbnail: true },
          ],
        ]),
      }),
    );
    expect(plan.problems).toEqual([]);
    expect(plan.counts).toMatchObject({ keepExercises: 1, keepMedia: 1, uploadMedia: 0 });
  });

  it("actualiza el ejercicio cuando cambió la catalogación", () => {
    const plan = planLibraryImport(
      manifestWith([createEntry]),
      cleanState({
        createdExercises: new Map([
          [createEntry.key, { id: "ex-1", externalVersion: "antigua", activeMediaCount: 0 }],
        ]),
      }),
    );
    expect(plan.counts.updateExercises).toBe(1);
  });

  it("vuelve a subir si el vídeo registrado no tiene póster", () => {
    const plan = planLibraryImport(
      manifestWith([createEntry]),
      cleanState({
        createdExercises: new Map([[createEntry.key, { id: "ex-1", externalVersion: null, activeMediaCount: 1 }]]),
        existingMedia: new Map([
          [
            mediaIdentity("ex-1", "HOMBRE", "video/mp4"),
            { checksumSha256: SHA.video, active: true, hasThumbnail: false },
          ],
        ]),
      }),
    );
    expect(plan.media[0].type).toBe("UPLOAD");
  });

  it("bloquea la carga si un archivo no es el del manifiesto", () => {
    const state = cleanState();
    const files = new Map(state.fileChecksums);
    files.set("procesado/bib-pliometria-sentadilla-bulgara-con-salto/hombre.mp4", "f".repeat(64));
    const plan = planLibraryImport(manifestWith([createEntry]), { ...state, fileChecksums: files });
    expect(plan.problems.join(" ")).toContain("SHA-256 distinto");
  });

  it("bloquea la carga si falta el póster", () => {
    const state = cleanState();
    const files = new Map(state.fileChecksums);
    files.delete("procesado/bib-pliometria-sentadilla-bulgara-con-salto/hombre-poster.webp");
    const plan = planLibraryImport(manifestWith([createEntry]), { ...state, fileChecksums: files });
    expect(plan.problems.join(" ")).toContain("falta el archivo");
  });

  it("arrastra los motivos de ffprobe", () => {
    const plan = planLibraryImport(
      manifestWith([createEntry]),
      cleanState({
        videoProblems: new Map([
          [createEntry.media[0].file, ["El archivo lleva pista de audio; debe exportarse sin audio."]],
        ]),
      }),
    );
    expect(plan.problems.join(" ")).toContain("pista de audio");
  });

  it("detecta un nombre que choca con un ejercicio global escrito a mano", () => {
    const plan = planLibraryImport(
      manifestWith([createEntry]),
      cleanState({ foreignCustomNames: new Set(["sentadilla búlgara con salto"]) }),
    );
    expect(plan.problems.join(" ")).toContain("ya existe un ejercicio global");
  });

  it("detecta dos entradas con el mismo nombre", () => {
    const twin = { ...createEntry, key: "bib:pliometria:otra-clave" };
    const plan = planLibraryImport(manifestWith([createEntry, twin]), cleanState());
    expect(plan.problems.join(" ")).toContain("ya lo usa");
  });

  it("detecta dos piezas con la misma variante y formato en un ejercicio", () => {
    const entry = {
      ...createEntry,
      media: [
        video(),
        video({
          file: "procesado/clip/hombre.mp4",
          sha256: SHA.clip,
          poster: { file: "procesado/clip/hombre-poster.webp", sha256: SHA.clipPoster },
        }),
      ],
    };
    const plan = planLibraryImport(manifestWith([entry]), cleanState());
    expect(plan.problems.join(" ")).toContain("misma variante y formato");
  });

  it("enlaza a un ejercicio existente y su vídeo pasa a ser el principal", () => {
    const link = {
      decision: "LINK",
      key: "link:burpee",
      linkExternalId: "0123",
      names: { es: "Burpee", pt: "Burpees", en: "burpee" },
      media: [video()],
    };
    const plan = planLibraryImport(manifestWith([link]), cleanState());
    expect(plan.problems).toEqual([]);
    expect(plan.exercises[0]).toEqual({ type: "LINK_EXERCISE", key: "link:burpee", exerciseId: "target-id" });
    expect(plan.media[0].isPrimary).toBe(true);
  });

  it("bloquea un enlace a un ejercicio que no existe", () => {
    const link = {
      decision: "LINK",
      key: "link:burpee",
      linkExternalId: "9999",
      names: { es: "Burpee", pt: "Burpees", en: "burpee" },
      media: [video()],
    };
    const plan = planLibraryImport(manifestWith([link]), cleanState());
    expect(plan.problems.join(" ")).toContain("no existe el ejercicio 9999");
  });

  it("no pide como principal una pieza con marca ajena visible", () => {
    const entry = {
      ...createEntry,
      media: [
        video({
          file: "procesado/clip/hombre.mp4",
          sha256: SHA.clip,
          poster: { file: "procesado/clip/hombre-poster.webp", sha256: SHA.clipPoster },
          brandingVisible: true,
        }),
      ],
    };
    const plan = planLibraryImport(manifestWith([entry]), cleanState());
    expect(plan.media[0].isPrimary).toBe(false);
  });

  it("respeta el máximo de 10 medios activos por ejercicio", () => {
    const link = {
      decision: "LINK",
      key: "link:burpee",
      linkExternalId: "0123",
      names: { es: "Burpee", pt: "Burpees", en: "burpee" },
      media: [video()],
    };
    const plan = planLibraryImport(
      manifestWith([link]),
      cleanState({ linkTargets: new Map([["0123", { id: "target-id", activeMediaCount: 10 }]]) }),
    );
    expect(plan.problems.join(" ")).toContain("superaría 10 medios activos");
  });
});
