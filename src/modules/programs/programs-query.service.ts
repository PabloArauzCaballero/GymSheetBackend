import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessDateService } from '../../common/time/business-date.service';
import { TrainingRepository } from '../training/training.repository';
import { goalWeek, workingWeightForGoalWeek } from './engine/strength-goals';
import { roundToPlate } from './engine/week-generation';
import { weekNumberOn } from './engine/program-calendar';
import { mapLift, mapProgram, ProgramView } from './program-view';
import { ProgramsRepository } from './programs.repository';
import { TrainingProgramModel } from './program.models';

export type NextLoadsView = {
  programaId: string;
  semana: number | null;
  esDescarga: boolean;
  items: Array<{
    ejercicioId: string;
    ejercicioNombre: string | null;
    pesoSugeridoKg: number;
    repsMin: number;
    repsMax: number;
    rirObjetivo: number | null;
    mensaje: string | null;
  }>;
};

/** Lecturas de programas: vista, resumen, avance y cargas sugeridas. */
@Injectable()
export class ProgramsQueryService {
  constructor(
    private readonly programs: ProgramsRepository,
    private readonly routines: TrainingRepository,
    private readonly dates: BusinessDateService,
  ) {}

  async viewById(programId: string): Promise<ProgramView> {
    const program = await this.programs.findById(programId);
    if (!program) throw new NotFoundException('Programa no encontrado.');
    return this.view(program);
  }

  async view(program: TrainingProgramModel): Promise<ProgramView> {
    const [weeks, lifts, routine] = await Promise.all([
      this.programs.listWeeks(program.id),
      this.programs.listLifts(program.id),
      program.routineId ? this.routines.findRoutineById(program.routineId) : Promise.resolve(null),
    ]);
    return mapProgram({
      program,
      routineName: routine?.name ?? null,
      weeks,
      lifts,
      names: this.namesOf(routine),
      today: this.dates.today(),
    });
  }

  /** Resumen mínimo para el aviso de conflicto al activar otro programa. */
  async summaryOf(program: TrainingProgramModel) {
    const view = await this.view(program);
    return {
      id: view.id,
      rutinaNombre: view.rutinaNombre,
      semanaActual: view.semanaActual,
      semanasTotales: view.semanasTotales,
    };
  }

  async getActive(userId: string): Promise<{ fuerza: ProgramView | null; cardio: ProgramView | null }> {
    const [strength, cardio] = await Promise.all([
      this.programs.findActive(userId, 'STRENGTH'),
      this.programs.findActive(userId, 'CARDIO'),
    ]);
    return {
      fuerza: strength ? await this.view(strength) : null,
      cardio: cardio ? await this.view(cardio) : null,
    };
  }

  async owned(userId: string, programId: string): Promise<TrainingProgramModel> {
    const program = await this.programs.findById(programId);
    // Un programa ajeno responde 404: no se confirma que exista.
    if (!program || program.userId !== userId) throw new NotFoundException('Programa no encontrado.');
    return program;
  }

  async progress(userId: string, programId: string) {
    const program = await this.owned(userId, programId);
    const weeks = await this.programs.listWeeks(program.id);
    return {
      programa: await this.view(program),
      semanas: weeks.map((w) => ({
        numero: w.weekNumber,
        inicio: w.weekStart,
        esDescarga: w.isDeload,
        sesionesPlan: w.sessionsPlan,
        sesionesHechas: w.sessionsDone,
        minutosCardio: w.cardioMinutes,
        cumplida: w.fulfilled,
        multiplicador: w.multiplier == null ? null : Number(w.multiplier),
      })),
    };
  }

  /**
   * Peso sugerido para la próxima sesión. Sobrecarga: el peso sugerido (con 90 %
   * en semanas de descarga). Metas: % del e1RM de la semana del bloque.
   */
  async nextLoads(userId: string, programId: string): Promise<NextLoadsView> {
    const program = await this.owned(userId, programId);
    const [lifts, routine, weeks] = await Promise.all([
      this.programs.listLifts(program.id),
      program.routineId ? this.routines.findRoutineById(program.routineId) : Promise.resolve(null),
      this.programs.listWeeks(program.id),
    ]);
    const number = weekNumberOn(this.dates.today(), program.startDate, program.plannedEndDate);
    const week = weeks.find((w) => w.weekNumber === number) ?? null;
    const names = this.namesOf(routine);
    const deload = week?.isDeload ?? false;
    return {
      programaId: program.id,
      semana: number,
      esDescarga: deload,
      items: lifts.map((lift) => {
        const base = mapLift(lift, names);
        let kg = base.pesoSugeridoKg;
        let message: string | null = null;
        if (program.mode === 'STRENGTH_GOALS') {
          const e1rm = base.marcaActualKg ?? base.marcaInicialKg ?? 0;
          kg = workingWeightForGoalWeek(number ?? 1, e1rm);
          if (goalWeek(number ?? 1).isDeload) message = 'Semana de descarga.';
        } else if (deload) {
          kg = roundToPlate(kg * 0.9);
          message = 'Semana de descarga: carga al 90 %.';
        }
        return {
          ejercicioId: base.ejercicioId,
          ejercicioNombre: base.ejercicioNombre,
          pesoSugeridoKg: kg,
          repsMin: base.repsMin,
          repsMax: base.repsMax,
          rirObjetivo: base.rirObjetivo,
          mensaje: message,
        };
      }),
    };
  }

  private namesOf(routine: Awaited<ReturnType<TrainingRepository['findRoutineById']>>): Map<string, string> {
    return new Map((routine?.exercises ?? []).map((e) => [e.exerciseId, e.exercise?.name ?? '']));
  }
}
