import { Logger } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { equipmentCatalog } from "../../modules/equipment/equipment-catalog";

const logger = new Logger("EquipmentCatalogSeeder");

/**
 * Siembra el equipamiento sugerido que casi todo gimnasio tiene.
 *
 * Va en la siembra **base**, no en la de datos de prueba: no es contenido de
 * demostración sino el punto de partida de cualquier instalación real. Sin
 * esto, un gimnasio recién desplegado abre el panel de equipamiento vacío y
 * tiene que escribir cuarenta fichas antes de que la aplicación le diga nada,
 * que es exactamente el momento en que la gente abandona una herramienta nueva.
 *
 * Es **idempotente por nombre**: se ejecuta en cada despliegue y no duplica.
 * Deliberadamente no actualiza lo que ya existe —si el gimnasio renombró su
 * prensa o la marcó en mantenimiento, esa es su decisión y una siembra no debe
 * pisarla—. Sólo añade lo que falta.
 *
 * Tampoco borra: un catálogo que retirase equipamiento al cambiar esta lista
 * destruiría las fichas que el gimnasio hubiera completado con su número de
 * serie y su historial de mantenimiento.
 */
export async function seedEquipmentCatalog(
  sequelize: Sequelize,
  transaction: Transaction,
): Promise<{ created: number; skipped: number }> {
  const existing = await sequelize.query<{ nombre: string }>(
    "SELECT nombre FROM equipos_gym",
    { type: QueryTypes.SELECT, transaction },
  );
  const known = new Set(existing.map((row) => row.nombre.toLowerCase()));

  let created = 0;
  let skipped = 0;
  for (const item of equipmentCatalog) {
    if (known.has(item.nombre.toLowerCase())) {
      skipped += 1;
      continue;
    }
    await sequelize.query(
      `INSERT INTO equipos_gym (id, nombre, tipo, estado, metadata, created_at, updated_at)
       VALUES (gen_random_uuid(), :nombre, :tipo, 'DISPONIBLE', :metadata::jsonb, now(), now())`,
      {
        type: QueryTypes.INSERT,
        replacements: {
          nombre: item.nombre,
          tipo: item.tipo,
          // La clave del catálogo viaja en los metadatos para poder reconocer
          // la misma máquina entre sedes aunque una la renombre después.
          metadata: JSON.stringify({ catalogo: item.clave, zona: item.zona }),
        },
        transaction,
      },
    );
    created += 1;
    known.add(item.nombre.toLowerCase());
  }

  logger.log({ event: "equipment.catalog.seeded", created, skipped });
  return { created, skipped };
}
