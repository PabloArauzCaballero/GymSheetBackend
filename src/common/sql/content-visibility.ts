/**
 * Fragmentos SQL de «¿puede esta persona ver este contenido?» para rutinas y
 * ejercicios. Existen para que la moderación, la comunidad y los ejercicios
 * respondan lo mismo; la versión en TypeScript es `canViewRoutine`
 * (training/routine-access.policy.ts) y ambas deben coincidir.
 *
 * `alias` es el alias de la tabla en la consulta y `user` el nombre del
 * parámetro enlazado (`:userId`), nunca un valor interpolado.
 */
export function routineVisibleSql(alias: string, user: string): string {
  return `(${alias}.estado = 'ACTIVE' AND (
    ${alias}.created_by_user_id = ${user}
    OR (${alias}.visibilidad = 'PUBLIC' AND ${alias}.estado_moderacion = 'VISIBLE')
    OR (${alias}.estado_moderacion = 'VISIBLE' AND (
         EXISTS (SELECT 1 FROM training.routine_shares vs
                  WHERE vs.routine_id = ${alias}.id AND vs.invitado_id = ${user} AND vs.estado = 'ACCEPTED')
         OR EXISTS (SELECT 1 FROM training.routine_assignments va
                     WHERE va.routine_id = ${alias}.id AND va.cliente_user_id = ${user} AND va.estado = 'ACTIVE')))
  ))`;
}

/** Global, propio, o privado ajeno que llega por una rutina que sí puede ver (D3). */
export function exerciseVisibleSql(alias: string, user: string): string {
  return `(${alias}.estado = 'ACTIVO' AND (
    ${alias}.tipo_ejercicio = 'GLOBAL'
    OR ${alias}.created_by_usuario_id = ${user}
    OR (${alias}.estado_moderacion = 'VISIBLE' AND EXISTS (
         SELECT 1 FROM training.routine_exercises vre
           JOIN training.routines vr ON vr.id = vre.routine_id
          WHERE vre.ejercicio_id = ${alias}.id AND ${routineVisibleSql('vr', user)}))
  ))`;
}
