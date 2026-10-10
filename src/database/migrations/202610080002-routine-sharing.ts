import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/** Compartir rutinas privadas con invitación aceptar/rechazar (RF-13, D4, D15). */
const upStatements = [
  `CREATE TABLE training.routine_shares (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     routine_id uuid NOT NULL REFERENCES training.routines(id) ON DELETE CASCADE,
     propietario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     invitado_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     estado varchar(12) NOT NULL,
     origen varchar(12) NOT NULL DEFAULT 'INVITACION',
     respondida_en timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_routine_share_estado CHECK (estado IN ('PENDING','ACCEPTED','DECLINED','REVOKED')),
     CONSTRAINT ck_routine_share_origen CHECK (origen IN ('INVITACION','ENTRENADOR')),
     CONSTRAINT ck_routine_share_distintos CHECK (propietario_id <> invitado_id)
   )`,
  `CREATE UNIQUE INDEX uq_routine_shares_vivas ON training.routine_shares(routine_id, invitado_id)
     WHERE estado IN ('PENDING','ACCEPTED')`,
  `CREATE INDEX ix_routine_shares_invitado ON training.routine_shares(invitado_id, estado)`,
  `CREATE INDEX ix_routine_shares_propietario ON training.routine_shares(propietario_id, routine_id)`,
  // D15: las asignaciones activas del entrenador aparecen como compartidas ya aceptadas.
  `INSERT INTO training.routine_shares (routine_id, propietario_id, invitado_id, estado, origen, respondida_en)
     SELECT DISTINCT ON (a.routine_id, a.cliente_user_id)
            a.routine_id, a.asignado_por_user_id, a.cliente_user_id, 'ACCEPTED', 'ENTRENADOR', a.created_at
     FROM training.routine_assignments a
     WHERE a.estado = 'ACTIVE' AND a.asignado_por_user_id <> a.cliente_user_id
     ORDER BY a.routine_id, a.cliente_user_id, a.created_at
     ON CONFLICT DO NOTHING`,
] as const;

const downStatements = [`DROP TABLE IF EXISTS training.routine_shares`] as const;

export const routineSharingMigration: DatabaseMigration = {
  id: '202610080002-routine-sharing',
  description: 'Routine shares with accept/decline invitations; coach assignments become accepted shares.',
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
