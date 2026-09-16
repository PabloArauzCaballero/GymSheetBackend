import { gzipSync } from "zlib";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  chunk,
  exercisesSnapshotSchema,
  readSnapshot,
  resolveSnapshotFile,
  SNAPSHOT_CHUNK_SIZE,
} from "./exercises-snapshot.seed";
import {
  EXERCISES_BOOT_SNAPSHOT_GZIP_PATH,
  EXERCISES_BOOT_SNAPSHOT_PATH,
} from "../canonical-exercises-bootstrap";

const exercise = {
  nombre: "3/4 sit-up",
  grupo_muscular: "hip flexors",
  descripcion: "Túmbate sobre tu espalda con las rodillas flexionadas.",
  tipo_ejercicio: "GLOBAL",
  estado: "ACTIVO",
  data_source: "EXERCISES_DATASET",
  external_id: "0001",
  external_version: "f22e5285",
  source_url: "https://example.test/exercises.json",
  source_license: "MIT data",
  source_attribution: "free-exercise-db contributors",
  category: "strength",
  body_part: "waist",
  required_equipment: "body weight",
  target_muscle: "iliopsoas",
  synergist_muscle_group: "hip flexors",
  secondary_muscles: ["abs"],
  instructions: { es: "Paso uno.", en: "Step one." },
  instruction_steps: { es: ["Paso uno."], en: ["Step one."] },
  metadata: { mediaId: "0001" },
};

const snapshot = {
  version: 1,
  generatedAt: "2026-09-16",
  source: "gym_sheet (1 ejercicios)",
  count: 1,
  exercises: [exercise],
};

describe("exercisesSnapshotSchema", () => {
  it("acepta un snapshot con los campos canónicos de un ejercicio", () => {
    expect(exercisesSnapshotSchema.parse(snapshot).exercises).toHaveLength(1);
  });

  it("rechaza un ejercicio sin identificador externo", () => {
    const { external_id: _omitted, ...withoutExternalId } = exercise;
    const invalid = { ...snapshot, exercises: [withoutExternalId] };
    expect(() => exercisesSnapshotSchema.parse(invalid)).toThrow();
  });

  /**
   * La versión es literal a propósito: si algún día cambia el formato, una
   * instalación vieja debe fallar al leerlo en vez de insertar filas a medias.
   */
  it("rechaza una versión de formato desconocida", () => {
    expect(() =>
      exercisesSnapshotSchema.parse({ ...snapshot, version: 2 }),
    ).toThrow();
  });
});

describe("chunk", () => {
  it("parte en lotes del tamaño pedido y conserva el orden", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("devuelve nada para una lista vacía", () => {
    expect(chunk([], SNAPSHOT_CHUNK_SIZE)).toEqual([]);
  });

  it("no admite un tamaño de lote de cero: sería un bucle infinito", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("resolveSnapshotFile", () => {
  it("prefiere el comprimido cuando están los dos", () => {
    const file = resolveSnapshotFile(() => true);
    expect(file).toContain(EXERCISES_BOOT_SNAPSHOT_GZIP_PATH);
  });

  it("acepta el JSON en claro si no hay comprimido", () => {
    const file = resolveSnapshotFile((path) => !path.endsWith(".gz"));
    expect(file).toContain(EXERCISES_BOOT_SNAPSHOT_PATH);
    expect(file?.endsWith(".gz")).toBe(false);
  });

  it("devuelve nulo cuando no hay ninguno, para que el arranque no falle", () => {
    expect(resolveSnapshotFile(() => false)).toBeNull();
  });
});

describe("readSnapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "gymsheet-snapshot-"));

  it("lee el JSON en claro", () => {
    const file = join(directory, "exercises.snapshot.json");
    writeFileSync(file, JSON.stringify(snapshot));
    expect(readSnapshot(file).count).toBe(1);
  });

  it("lee el comprimido, que es el formato versionado en el repo", () => {
    const file = join(directory, "exercises.snapshot.json.gz");
    writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(snapshot))));
    expect(readSnapshot(file).exercises[0].nombre).toBe("3/4 sit-up");
  });
});
