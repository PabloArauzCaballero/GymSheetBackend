import { readdirSync } from "node:fs";
import { databaseMigrations } from "./index";

/**
 * Una migración que existe como archivo pero no figura en `databaseMigrations`
 * **no se ejecuta nunca, y nada avisa**: el runner solo recorre el registro. Es
 * lo que pasó con `202609160002-profile-birth-date`: el modelo ya leía
 * `fecha_nacimiento`, la columna no existía en ninguna base nueva y la siembra
 * de desarrollo moría con `column "fecha_nacimiento" does not exist`.
 *
 * Esta prueba compara el directorio con el registro, así que el olvido salta al
 * añadir el archivo y no cuando alguien levanta una base desde cero.
 */
const MIGRATION_FILE = /^(\d{12}-[a-z0-9-]+)\.ts$/;

const filesOnDisk = readdirSync(__dirname)
  .map((name) => MIGRATION_FILE.exec(name)?.[1])
  .filter((id): id is string => id !== undefined)
  .sort();

describe("migration registry", () => {
  it("registers every migration file in the directory", () => {
    const registered = new Set(databaseMigrations.map((migration) => migration.id));
    const missing = filesOnDisk.filter((id) => !registered.has(id));
    expect(missing).toEqual([]);
  });

  it("does not register an id that has no file", () => {
    const onDisk = new Set(filesOnDisk);
    const orphans = databaseMigrations
      .map((migration) => migration.id)
      .filter((id) => !onDisk.has(id));
    expect(orphans).toEqual([]);
  });

  it("registers each id once", () => {
    const ids = databaseMigrations.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds the migration files it is meant to guard", () => {
    // Sin esto, un cambio de nombre de directorio dejaría las demás pruebas
    // comparando una lista vacía contra otra y pasando en vacío.
    expect(filesOnDisk.length).toBeGreaterThan(40);
  });
});
