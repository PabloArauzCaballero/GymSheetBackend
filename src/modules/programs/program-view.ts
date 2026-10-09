import { ProgramLiftTargetModel, ProgramWeekModel, TrainingProgramModel } from './program.models';
import { weekNumberOn } from './engine/program-calendar';

export type LiftTargetView = {
  ejercicioId: string;
  ejercicioNombre: string | null;
  pesoTrabajoKg: number;
  pesoSugeridoKg: number;
  repsMin: number;
  repsMax: number;
  rirObjetivo: number | null;
  incrementoKg: number;
  marcaInicialKg: number | null;
  marcaActualKg: number | null;
  marcaMetaKg: number | null;
  fechaMeta: string | null;
  alcanzadaEn: Date | null;
};

export type ProgramView = {
  id: string;
  carril: string;
  modo: string;
  estado: string;
  motivoCierre: string | null;
  rutinaId: string | null;
  rutinaNombre: string | null;
  cardioPlanId: string | null;
  fechaInicio: string;
  fechaFinPrevista: string;
  semanaActual: number | null;
  semanasTotales: number;
  multiplicador: number;
  proximoMultiplicador: number;
  sesionesHechasSemana: number;
  sesionesPlanSemana: number;
  esDescarga: boolean;
  metas: LiftTargetView[];
};

export function mapLift(row: ProgramLiftTargetModel, names: ReadonlyMap<string, string>): LiftTargetView {
  const num = (v: string | null) => (v == null ? null : Number(v));
  return {
    ejercicioId: row.exerciseId,
    ejercicioNombre: names.get(row.exerciseId) ?? null,
    pesoTrabajoKg: Number(row.workingWeightKg),
    pesoSugeridoKg: Number(row.suggestedKg),
    repsMin: row.repsMin,
    repsMax: row.repsMax,
    rirObjetivo: row.rirTarget,
    incrementoKg: Number(row.incrementKg),
    marcaInicialKg: num(row.initialE1rmKg),
    marcaActualKg: num(row.currentE1rmKg),
    marcaMetaKg: num(row.goalKg),
    fechaMeta: row.goalDate,
    alcanzadaEn: row.reachedAt,
  };
}

export function mapProgram(input: {
  program: TrainingProgramModel;
  routineName: string | null;
  weeks: readonly ProgramWeekModel[];
  lifts: readonly ProgramLiftTargetModel[];
  names: ReadonlyMap<string, string>;
  today: string;
}): ProgramView {
  const { program, weeks, today } = input;
  const current = weekNumberOn(today, program.startDate, program.plannedEndDate);
  const week = weeks.find((w) => w.weekNumber === current) ?? null;
  const multiplier = Number(program.multiplier);
  return {
    id: program.id,
    carril: program.lane,
    modo: program.mode,
    estado: program.status,
    motivoCierre: program.closeReason,
    rutinaId: program.routineId,
    rutinaNombre: input.routineName,
    cardioPlanId: program.cardioPlanId,
    fechaInicio: program.startDate,
    fechaFinPrevista: program.plannedEndDate,
    semanaActual: current,
    semanasTotales: weeks.length,
    multiplicador: multiplier,
    proximoMultiplicador: Math.min(Math.round((multiplier + 0.2) * 100) / 100, 2),
    sesionesHechasSemana: week?.sessionsDone ?? 0,
    sesionesPlanSemana: week?.sessionsPlan ?? 0,
    esDescarga: week?.isDeload ?? false,
    metas: input.lifts.map((l) => mapLift(l, input.names)),
  };
}
