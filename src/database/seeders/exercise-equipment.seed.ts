import { Logger } from "@nestjs/common";
import { QueryTypes, Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { equipmentCatalog } from "../../modules/equipment/equipment-catalog";
import {
  normalizeForMatch,
  resolveEquipmentClaves,
} from "../../modules/equipment/exercise-equipment.taxonomy";

const logger = new Logger("ExerciseEquipmentSeeder");

interface ExerciseRow {
  id: string;
  nombre: string;
  required_equipment: string | null;
}

interface EquipmentRow {
  id: string;
  nombre: string;
  metadata: { catalogo?: string } | null;
}

/**
 * Enlaza el catálogo de ejercicios con el de máquinas.
 *
 * Es lo que hace posible el informe de uso por máquina sin pedirle nada al
 * usuario final: quien entrena registra series de un ejercicio, y el gimnasio
 * lee qué equipamiento hubo detrás. Sin este paso el catálogo de equipamiento
 * existe pero no lo toca nadie, y el panel de operación agrupa por nombre de
 * ejercicio, que no dice qué comprar.
 *
 * Corre con la siembra base, después del catálogo de equipamiento, porque
 * necesita que las máquinas existan para poder apuntar a ellas.
 *
 * **Sólo añade lo que falta y nunca reemplaza.** Un ejercicio que ya tenga
 * equipamiento asignado se deja como está: si alguien del gimnasio corrigió a
 * mano que su press de banca es en multipower, una siembra posterior no puede
 * deshacerlo. Esa es también la razón de que la inferencia se aplique una sola
 * vez por ejercicio y no se recalcule: el dato manual gana.
 */
export async function seedExerciseEquipment(
  sequelize: Sequelize,
  transaction: Transaction,
): Promise<{ linked: number; exercises: number; unresolved: number }> {
  const equipment = await sequelize.query<EquipmentRow>(
    "SELECT id, nombre, metadata FROM equipos_gym",
    { type: QueryTypes.SELECT, transaction },
  );

  // La clave del catálogo viaja en los metadatos; para el equipamiento que el
  // gimnasio creó a mano se cae al nombre, que es lo único que hay.
  const idByClave = new Map<string, string>();
  const claveByNombre = new Map<string, string>();
  for (const item of equipmentCatalog) {
    claveByNombre.set(normalizeForMatch(item.nombre), item.clave);
  }
  for (const row of equipment) {
    const clave =
      row.metadata?.catalogo ?? claveByNombre.get(normalizeForMatch(row.nombre));
    if (clave && !idByClave.has(clave)) idByClave.set(clave, row.id);
  }

  // Sólo los ejercicios activos del catálogo compartido y sin equipamiento
  // asignado todavía.
  const exercises = await sequelize.query<ExerciseRow>(
    `SELECT e.id, e.nombre, e.required_equipment
       FROM ejercicios e
      WHERE e.created_by_usuario_id IS NULL
        AND e.estado = 'ACTIVO'
        AND NOT EXISTS (
          SELECT 1 FROM ejercicios_equipos ee WHERE ee.ejercicio_id = e.id
        )`,
    { type: QueryTypes.SELECT, transaction },
  );

  let linked = 0;
  let unresolved = 0;
  for (const exercise of exercises) {
    const claves = resolveEquipmentClaves(
      exercise.nombre,
      exercise.required_equipment,
    );
    const equipmentIds = claves
      .map((clave) => idByClave.get(clave))
      .filter((id): id is string => Boolean(id));

    if (equipmentIds.length === 0) {
      unresolved += 1;
      continue;
    }

    for (const equipmentId of equipmentIds) {
      await sequelize.query(
        `INSERT INTO ejercicios_equipos (id, ejercicio_id, equipo_gym_id, created_at, updated_at)
         VALUES (gen_random_uuid(), :ejercicioId, :equipoId, now(), now())
         ON CONFLICT DO NOTHING`,
        {
          type: QueryTypes.INSERT,
          replacements: { ejercicioId: exercise.id, equipoId: equipmentId },
          transaction,
        },
      );
      linked += 1;
    }
  }

  // `unresolved` no es un fallo: son los ejercicios para los que la taxonomía
  // prefirió callarse. Se registra para que se vea crecer si el catálogo se
  // llena de nombres que las reglas no reconocen.
  logger.log({
    event: "exercise.equipment.seeded",
    exercises: exercises.length,
    linked,
    unresolved,
  });
  return { linked, exercises: exercises.length, unresolved };
}
