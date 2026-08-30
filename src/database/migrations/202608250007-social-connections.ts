import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Capa social: conexiones entre socios y estado social del perfil.
 *
 * Primer eslabón real del grafo social — hoy la única relación entre dos
 * usuarios es coach→cliente (`training.routine_assignments`), que no sirve
 * para esto: no es simétrica ni algo que ninguna de las dos partes pida.
 *
 * El índice único es parcial (`WHERE status <> 'REJECTED'`): mientras una
 * solicitud está pendiente o aceptada, no se puede mandar otra en ningún
 * sentido — pero un rechazo no bloquea intentarlo de nuevo más adelante.
 */
const upStatements = [
  `CREATE SCHEMA IF NOT EXISTS social`,
  `CREATE TABLE social.connections (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     requester_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     addressee_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     status varchar(12) NOT NULL DEFAULT 'PENDING',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     responded_at timestamptz,
     CONSTRAINT ck_connections_status CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
     CONSTRAINT ck_connections_not_self CHECK (requester_id <> addressee_id)
   )`,
  `CREATE UNIQUE INDEX uq_connections_active_pair
     ON social.connections (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
     WHERE status <> 'REJECTED'`,
  `CREATE INDEX ix_connections_addressee ON social.connections (addressee_id, status)`,
  `CREATE INDEX ix_connections_requester ON social.connections (requester_id, status)`,
  `CREATE TABLE social.profile_settings (
     user_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
     social_status varchar(20),
     visible boolean NOT NULL DEFAULT false,
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_profile_settings_status
       CHECK (social_status IS NULL OR social_status IN ('OPEN_TO_MEET','IN_RELATIONSHIP','SINGLE'))
   )`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS social.profile_settings`,
  `DROP TABLE IF EXISTS social.connections`,
  `DROP SCHEMA IF EXISTS social`,
] as const;

export const socialConnectionsMigration: DatabaseMigration = {
  id: "202608250007-social-connections",
  description: "Friend-style connections between members and an optional social status on the profile.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
