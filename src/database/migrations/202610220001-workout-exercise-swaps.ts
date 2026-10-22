import { DatabaseMigration } from './migration.types';
import { executeSqlStatements } from './sql-migration.helpers';

/**
 * Historial de cambios de ejercicio durante un entreno: qué se cambió por qué,
 * con qué motivo y si fue solo esa sesión o también en la rutina.
 *
 * Sirve para dos cosas: que la persona vea por qué su sesión no es idéntica a
 * la rutina, y para aprender qué máquinas están siempre ocupadas o qué
 * ejercicios dan molestias (sin inventar nada: son hechos registrados).
 */
const upStatements = [
  `CREATE TABLE IF NOT EXISTS public.sesiones_ejercicios_cambios (
     id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
     usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
     sesion_id uuid NOT NULL REFERENCES public.sesiones_entrenamiento(id) ON DELETE CASCADE,
     sesion_ejercicio_id uuid REFERENCES public.sesiones_ejercicios(id) ON DELETE SET NULL,
     ejercicio_anterior_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     ejercicio_nuevo_id uuid NOT NULL REFERENCES public.ejercicios(id) ON DELETE CASCADE,
     motivo varchar(20) NOT NULL,
     nota varchar(280),
     alcance varchar(10) NOT NULL,
     rutina_id uuid,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT ck_cambio_motivo CHECK (motivo IN (
       'MAQUINA_OCUPADA','SIN_EQUIPO','MOLESTIA','MUY_DIFICIL','MUY_FACIL','PREFERENCIA','CAMBIO_DE_PLAN'
     )),
     CONSTRAINT ck_cambio_alcance CHECK (alcance IN ('SESION','RUTINA')),
     CONSTRAINT ck_cambio_distinto CHECK (ejercicio_anterior_id <> ejercicio_nuevo_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_sesiones_ejercicios_cambios_sesion
     ON public.sesiones_ejercicios_cambios (sesion_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS ix_sesiones_ejercicios_cambios_usuario
     ON public.sesiones_ejercicios_cambios (usuario_id, created_at DESC)`,
];

const downStatements = [`DROP TABLE IF EXISTS public.sesiones_ejercicios_cambios`];

export const workoutExerciseSwapsMigration: DatabaseMigration = {
  id: '202610220001-workout-exercise-swaps',
  description: 'Historial de cambios de ejercicio durante el entreno (motivo y alcance)',
  up: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, upStatements),
  down: (queryInterface, transaction) => executeSqlStatements(queryInterface, transaction, downStatements),
};
