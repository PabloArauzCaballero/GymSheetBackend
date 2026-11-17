import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

const LIVE = `('REQUESTED', 'CONFIRMED')`;
/** Every reason a request or an affiliation is closed (see `affiliation.catalog.ts`). */
const REASON_CODES = `'UNKNOWN_PERSON', 'CI_MISMATCH', 'WRONG_LOCATION', 'NOT_A_COACH_HERE', 'NO_LONGER_MEMBER', 'NO_LONGER_COACH',
  'CONDUCT', 'OTHER', 'WITHDRAWN', 'LEFT', 'SWITCHED_GYM', 'ACCOUNT_CLOSED'`;

/**
 * Franja 7b (ADR-0025): affiliations of persons and coaches to a gym, keyed on
 * the gym's directory entity (never on `usuarios.tenant_id`, which stays as it
 * is: 7c moves its readers).
 *
 * 1. `directory.entities` and `directory.entity_locations` gain a unique index
 *    on `(id, entity_type)` / `(id, entity_id)`: targets of composite foreign
 *    keys, so the database itself guarantees the gym is a GYM, the coach a
 *    COACH and the declared location one of THAT gym's.
 * 2. `directory.affiliations`: subject = a person (`user_id`) XOR a coach
 *    business (`coach_entity_id`, ENTRENADOR only); `kind` SOCIO|ENTRENADOR;
 *    `ci_last3` (exactly three digits, persons only, erased at closure);
 *    status REQUESTED → CONFIRMED|REJECTED|CANCELLED, CONFIRMED → ENDED.
 *    A live SOCIO always has a location: deleting a location that a live
 *    SOCIO declared fails on that CHECK (the API answers 409).
 *    Partial unique indexes: one live row per (subject, gym, kind); one
 *    CONFIRMED SOCIO per person across every gym; one pending SOCIO request
 *    per person (a gym switch is that single request).
 * 3. `directory.affiliation_history`, append-only, written by a trigger on
 *    every insert and status change: the history is complete even for the
 *    account closure, which only runs UPDATEs from its catalogue.
 *
 * Rollback: both tables, the trigger, its function and the two helper indexes
 * are dropped. Nothing older reads them, so the previous code is unaffected.
 */
const upStatements = [
  `CREATE UNIQUE INDEX ux_directory_entities_id_type ON directory.entities (id, entity_type)`,
  `CREATE UNIQUE INDEX ux_entity_locations_id_entity ON directory.entity_locations (id, entity_id)`,

  `CREATE TABLE directory.affiliations (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     gym_entity_id uuid NOT NULL,
     gym_entity_type varchar(20) GENERATED ALWAYS AS ('GYM') STORED,
     user_id uuid REFERENCES public.usuarios(id) ON DELETE RESTRICT,
     coach_entity_id uuid,
     coach_entity_type varchar(20) GENERATED ALWAYS AS (CASE WHEN coach_entity_id IS NOT NULL THEN 'COACH' END) STORED,
     kind varchar(10) NOT NULL,
     location_id uuid,
     ci_last3 char(3),
     status varchar(10) NOT NULL DEFAULT 'REQUESTED',
     replaces_affiliation_id uuid REFERENCES directory.affiliations(id) ON DELETE SET NULL,
     reason_code varchar(20),
     reason_note varchar(500),
     changed_by_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     requested_at timestamptz NOT NULL DEFAULT now(),
     confirmed_at timestamptz,
     closed_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT fk_affiliations_gym FOREIGN KEY (gym_entity_id, gym_entity_type)
       REFERENCES directory.entities (id, entity_type) ON DELETE RESTRICT,
     CONSTRAINT fk_affiliations_coach FOREIGN KEY (coach_entity_id, coach_entity_type)
       REFERENCES directory.entities (id, entity_type) ON DELETE RESTRICT,
     CONSTRAINT fk_affiliations_location FOREIGN KEY (location_id, gym_entity_id)
       REFERENCES directory.entity_locations (id, entity_id) ON DELETE SET NULL (location_id),
     CONSTRAINT ck_affiliations_subject CHECK ((user_id IS NULL) <> (coach_entity_id IS NULL)),
     CONSTRAINT ck_affiliations_kind CHECK (kind IN ('SOCIO', 'ENTRENADOR') AND (coach_entity_id IS NULL OR kind = 'ENTRENADOR')),
     CONSTRAINT ck_affiliations_status CHECK (status IN ('REQUESTED', 'CONFIRMED', 'REJECTED', 'ENDED', 'CANCELLED')),
     CONSTRAINT ck_affiliations_ci_last3 CHECK (
       (ci_last3 IS NULL OR ci_last3 ~ '^[0-9]{3}$')
       AND (coach_entity_id IS NULL OR ci_last3 IS NULL)
       AND (user_id IS NULL OR ci_last3 IS NOT NULL OR status NOT IN ${LIVE})),
     CONSTRAINT ck_affiliations_socio_location CHECK (kind <> 'SOCIO' OR status NOT IN ${LIVE} OR location_id IS NOT NULL),
     CONSTRAINT ck_affiliations_reason CHECK (
       (reason_code IS NULL OR reason_code IN (${REASON_CODES}))
       AND (status IN ${LIVE} OR reason_code IS NOT NULL)
       AND (reason_note IS NULL OR reason_code IS NOT NULL)),
     CONSTRAINT ck_affiliations_dates CHECK (
       (status IN ${LIVE}) = (closed_at IS NULL)
       AND (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
       AND (status NOT IN ('REQUESTED', 'REJECTED', 'CANCELLED') OR confirmed_at IS NULL)),
     CONSTRAINT ck_affiliations_replaces CHECK (replaces_affiliation_id IS NULL OR (kind = 'SOCIO' AND user_id IS NOT NULL))
   )`,
  `CREATE UNIQUE INDEX ux_affiliations_live_person ON directory.affiliations (user_id, gym_entity_id, kind)
     WHERE user_id IS NOT NULL AND status IN ${LIVE}`,
  `CREATE UNIQUE INDEX ux_affiliations_live_coach ON directory.affiliations (coach_entity_id, gym_entity_id)
     WHERE coach_entity_id IS NOT NULL AND status IN ${LIVE}`,
  // "Socio de exactly one gym", held by the database (also the 7c lookup of the current gym).
  `CREATE UNIQUE INDEX ux_affiliations_confirmed_socio ON directory.affiliations (user_id)
     WHERE kind = 'SOCIO' AND status = 'CONFIRMED'`,
  `CREATE UNIQUE INDEX ux_affiliations_requested_socio ON directory.affiliations (user_id)
     WHERE kind = 'SOCIO' AND status = 'REQUESTED'`,
  // The gym's inbox (oldest first) and its members and coaches (newest first; 7c counts members here).
  `CREATE INDEX ix_affiliations_gym_requested ON directory.affiliations (gym_entity_id, requested_at, id)
     WHERE status = 'REQUESTED'`,
  `CREATE INDEX ix_affiliations_gym_confirmed ON directory.affiliations (gym_entity_id, kind, confirmed_at DESC, id DESC)
     WHERE status = 'CONFIRMED'`,
  // Each subject's own list, newest first; also the cooldown lookups.
  `CREATE INDEX ix_affiliations_person ON directory.affiliations (user_id, requested_at DESC, id DESC) WHERE user_id IS NOT NULL`,
  `CREATE INDEX ix_affiliations_coach ON directory.affiliations (coach_entity_id, requested_at DESC, id DESC) WHERE coach_entity_id IS NOT NULL`,
  `CREATE INDEX ix_affiliations_location ON directory.affiliations (location_id) WHERE location_id IS NOT NULL`,

  `CREATE TABLE directory.affiliation_history (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     affiliation_id uuid NOT NULL REFERENCES directory.affiliations(id) ON DELETE CASCADE,
     from_status varchar(10),
     to_status varchar(10) NOT NULL,
     actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
     reason_code varchar(20),
     at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_affiliation_history_affiliation ON directory.affiliation_history (affiliation_id, at, id)`,
  `CREATE INDEX ix_affiliation_history_actor ON directory.affiliation_history (actor_user_id) WHERE actor_user_id IS NOT NULL`,
  `CREATE FUNCTION directory.affiliations_record_history() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
       INSERT INTO directory.affiliation_history (affiliation_id, from_status, to_status, actor_user_id, reason_code)
       VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.changed_by_user_id, NEW.reason_code);
     END IF;
     RETURN NULL;
   END $$`,
  `CREATE TRIGGER trg_affiliations_history AFTER INSERT OR UPDATE OF status ON directory.affiliations
     FOR EACH ROW EXECUTE FUNCTION directory.affiliations_record_history()`,
] as const;

const downStatements = [
  `DROP TRIGGER IF EXISTS trg_affiliations_history ON directory.affiliations`,
  `DROP FUNCTION IF EXISTS directory.affiliations_record_history()`,
  `DROP TABLE IF EXISTS directory.affiliation_history`,
  `DROP TABLE IF EXISTS directory.affiliations`,
  `DROP INDEX IF EXISTS directory.ux_entity_locations_id_entity`,
  `DROP INDEX IF EXISTS directory.ux_directory_entities_id_type`,
] as const;

export const affiliationsMigration: DatabaseMigration = {
  id: "202611200901-affiliations",
  description:
    "Affiliations (ADR-0025): persons and coach businesses affiliated to a GYM entity as SOCIO or ENTRENADOR, with declared location, last three CI digits, DB-enforced uniqueness (one confirmed SOCIO per person) and a trigger-written append-only history.",
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
