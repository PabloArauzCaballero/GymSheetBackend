import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Impide que el catálogo global repita un ejercicio.
 *
 * Nada impedía dar de alta «Press de banca» tres veces: el alta global no
 * comprobaba el nombre, así que volver a ejecutar cualquier siembra o script de
 * demostración multiplicaba el catálogo. El daño lo ve el usuario final, que
 * abre el selector de ejercicios y encuentra tres filas idénticas sin forma de
 * saber cuál elegir; y lo ve el informe de uso por máquina, que reparte las
 * series de un mismo ejercicio entre tres fichas.
 *
 * La garantía va en la base de datos y no en una comprobación previa en el
 * servicio, porque dos altas simultáneas superan cualquier `SELECT` previo al
 * `INSERT`. El servicio traduce la violación a 409, que es lo que el script de
 * demostración ya esperaba recibir y nunca llegaba.
 *
 * El índice es parcial y sobre el nombre normalizado:
 *
 * - sólo alcanza a los ejercicios globales (`created_by_usuario_id IS NULL`),
 *   porque dos personas distintas sí pueden llamar igual a sus ejercicios
 *   personales y eso no es un error;
 * - sólo a los activos, y de ahí que baste con retirar los duplicados;
 * - `lower(btrim(...))` para que «press de banca » no entre como distinto.
 *
 * **No borra nada.** Los duplicados se retiran (`estado = 'INACTIVO'`)
 * conservando el más antiguo de cada nombre, que es al que apuntan las rutinas
 * y sesiones más antiguas. Un `DELETE` habría sido más limpio de leer y habría
 * destruido historial: las series ya registradas cuelgan de esas filas, y el
 * historial de entrenamiento es sólo-añadir.
 *
 * Lo que sí se repunta al superviviente es lo que mira hacia adelante —rutinas,
 * favoritos y preferencias—, para que nadie siga programando entrenamientos
 * contra una ficha retirada. Las sesiones ya cerradas se quedan donde están:
 * son el registro de lo que ocurrió y no se reescriben.
 */
const upStatements = [
  // Superviviente por nombre normalizado: el más antiguo de cada grupo.
  `CREATE TEMPORARY TABLE tmp_ejercicio_dedupe ON COMMIT DROP AS
     SELECT e.id AS duplicado_id,
            (
              SELECT o.id FROM ejercicios o
               WHERE o.created_by_usuario_id IS NULL
                 AND o.estado = 'ACTIVO'
                 AND lower(btrim(o.nombre)) = lower(btrim(e.nombre))
               ORDER BY o.created_at, o.id
               LIMIT 1
            ) AS superviviente_id
       FROM ejercicios e
      WHERE e.created_by_usuario_id IS NULL AND e.estado = 'ACTIVO'`,
  `DELETE FROM tmp_ejercicio_dedupe WHERE duplicado_id = superviviente_id`,

  // Programación futura: se lleva al superviviente. Donde la pareja
  // (ejercicio, persona) es única, la fila del duplicado se descarta si el
  // superviviente ya tiene la suya —repuntarla violaría esa unicidad—.
  //
  // Las rutinas no necesitan ese descarte: su unicidad es (rutina, orden) y no
  // menciona el ejercicio, así que cambiarlo nunca choca.
  `UPDATE training.routine_exercises d SET ejercicio_id = t.superviviente_id
     FROM tmp_ejercicio_dedupe t WHERE d.ejercicio_id = t.duplicado_id`,

  `DELETE FROM usuarios_ejercicios d
     USING tmp_ejercicio_dedupe t
     WHERE d.ejercicio_id = t.duplicado_id
       AND EXISTS (
         SELECT 1 FROM usuarios_ejercicios s
          WHERE s.ejercicio_id = t.superviviente_id
            AND s.usuario_id = d.usuario_id
       )`,
  `UPDATE usuarios_ejercicios d SET ejercicio_id = t.superviviente_id
     FROM tmp_ejercicio_dedupe t WHERE d.ejercicio_id = t.duplicado_id`,

  `DELETE FROM training.user_exercise_preferences d
     USING tmp_ejercicio_dedupe t
     WHERE d.ejercicio_id = t.duplicado_id
       AND EXISTS (
         SELECT 1 FROM training.user_exercise_preferences s
          WHERE s.ejercicio_id = t.superviviente_id
            AND s.usuario_id = d.usuario_id
       )`,
  `UPDATE training.user_exercise_preferences d SET ejercicio_id = t.superviviente_id
     FROM tmp_ejercicio_dedupe t WHERE d.ejercicio_id = t.duplicado_id`,

  // El equipamiento del duplicado se copia al superviviente sólo si allí falta:
  // el informe de uso por máquina lee esta relación, y una ficha retirada que
  // se llevara su única máquina dejaría el informe sin ese enlace.
  `INSERT INTO ejercicios_equipos (id, ejercicio_id, equipo_gym_id, created_at, updated_at)
     SELECT gen_random_uuid(), t.superviviente_id, d.equipo_gym_id, now(), now()
       FROM ejercicios_equipos d
       JOIN tmp_ejercicio_dedupe t ON t.duplicado_id = d.ejercicio_id
      WHERE NOT EXISTS (
        SELECT 1 FROM ejercicios_equipos s
         WHERE s.ejercicio_id = t.superviviente_id
           AND s.equipo_gym_id = d.equipo_gym_id
      )
      ON CONFLICT DO NOTHING`,

  // Retirada, no borrado: las sesiones ya registradas siguen apuntando aquí.
  `UPDATE ejercicios e
      SET estado = 'INACTIVO', updated_at = now()
     FROM tmp_ejercicio_dedupe t
    WHERE e.id = t.duplicado_id`,

  `CREATE UNIQUE INDEX ux_ejercicios_global_nombre
     ON ejercicios (lower(btrim(nombre)))
     WHERE created_by_usuario_id IS NULL AND estado = 'ACTIVO'`,
] as const;

const downStatements = [
  // Se retira la restricción. Los duplicados retirados no se reactivan: no se
  // puede saber cuáles lo estaban por esta migración y cuáles ya lo estaban, y
  // reactivarlos devolvería al catálogo las filas repetidas.
  `DROP INDEX IF EXISTS ux_ejercicios_global_nombre`,
] as const;

export const uniqueGlobalExerciseNameMigration: DatabaseMigration = {
  id: "202608200001-unique-global-exercise-name",
  description:
    "Retires duplicated global exercises and enforces a unique normalised name for the shared catalogue.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
