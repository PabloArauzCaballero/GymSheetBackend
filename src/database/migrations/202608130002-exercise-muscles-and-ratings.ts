import { DatabaseMigration } from "./migration.types";
import { executeSqlStatements } from "./sql-migration.helpers";

/**
 * Modelo de músculos, grupos musculares, relación ejercicio↔músculo (con rol),
 * puntuación editorial de ejercicios y preferencia personal por usuario.
 * Habilita recomendaciones por grupo muscular y por afinidad.
 */
const upStatements = [
  `CREATE TABLE training.muscle_groups (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     code varchar(40) NOT NULL UNIQUE,
     name varchar(80) NOT NULL,
     region varchar(20) NOT NULL,
     description text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_muscle_group_region CHECK (region IN ('UPPER','CORE','LOWER','SYSTEMIC'))
   )`,
  `CREATE TABLE training.muscles (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     code varchar(60) NOT NULL UNIQUE,
     name varchar(120) NOT NULL,
     latin_name varchar(160) NOT NULL,
     muscle_group_id uuid NOT NULL REFERENCES training.muscle_groups(id) ON DELETE RESTRICT,
     description text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_muscles_group ON training.muscles (muscle_group_id)`,
  `CREATE TABLE training.exercise_muscles (
     ejercicio_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     muscle_id uuid NOT NULL REFERENCES training.muscles(id) ON DELETE CASCADE,
     role varchar(20) NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (ejercicio_id, muscle_id),
     CONSTRAINT ck_exercise_muscle_role CHECK (role IN ('PRIMARY','SECONDARY','STABILIZER'))
   )`,
  `CREATE INDEX ix_exercise_muscles_muscle ON training.exercise_muscles (muscle_id, role)`,
  `CREATE TABLE training.exercise_ratings (
     ejercicio_id uuid PRIMARY KEY REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     recommended_stars smallint NOT NULL,
     fun_stars smallint NOT NULL,
     factors jsonb NOT NULL DEFAULT '{}'::jsonb,
     computed_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_exercise_rating_recommended CHECK (recommended_stars BETWEEN 1 AND 5),
     CONSTRAINT ck_exercise_rating_fun CHECK (fun_stars BETWEEN 1 AND 5)
   )`,
  `CREATE INDEX ix_exercise_ratings_recommended ON training.exercise_ratings (recommended_stars DESC)`,
  `CREATE TABLE training.user_exercise_preferences (
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     ejercicio_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     is_favorite boolean NOT NULL DEFAULT false,
     personal_rating smallint,
     notes varchar(300),
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (usuario_id, ejercicio_id),
     CONSTRAINT ck_user_exercise_personal_rating CHECK (personal_rating IS NULL OR personal_rating BETWEEN 1 AND 5)
   )`,
  `CREATE INDEX ix_user_exercise_pref_user ON training.user_exercise_preferences (usuario_id, is_favorite)`,
] as const;

const downStatements = [
  `DROP TABLE IF EXISTS training.user_exercise_preferences`,
  `DROP TABLE IF EXISTS training.exercise_ratings`,
  `DROP TABLE IF EXISTS training.exercise_muscles`,
  `DROP TABLE IF EXISTS training.muscles`,
  `DROP TABLE IF EXISTS training.muscle_groups`,
] as const;

export const exerciseMusclesAndRatingsMigration: DatabaseMigration = {
  id: "202608130002-exercise-muscles-and-ratings",
  description:
    "Muscles, muscle groups, exercise-muscle relations (roles), editorial exercise ratings and per-user preferences.",
  up: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) =>
    executeSqlStatements(queryInterface, transaction, downStatements),
};
