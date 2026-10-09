import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import {
  ProgramLane,
  ProgramLiftTargetModel,
  ProgramWeekModel,
  TrainingProgramModel,
} from './program.models';

@Injectable()
export class ProgramsRepository {
  constructor(
    @InjectModel(TrainingProgramModel) private readonly programs: typeof TrainingProgramModel,
    @InjectModel(ProgramLiftTargetModel) private readonly lifts: typeof ProgramLiftTargetModel,
    @InjectModel(ProgramWeekModel) private readonly weeks: typeof ProgramWeekModel,
  ) {}

  findActive(userId: string, lane: ProgramLane, transaction?: Transaction) {
    return this.programs.findOne({ where: { userId, lane, status: 'ACTIVE' }, transaction });
  }

  findById(id: string, transaction?: Transaction) {
    return this.programs.findByPk(id, { transaction });
  }

  /** Programas activos de todo el mundo cuya agenda debe cerrarse (job semanal). */
  listActive() {
    return this.programs.findAll({ where: { status: 'ACTIVE' } });
  }

  createProgram(values: Partial<TrainingProgramModel>, transaction: Transaction) {
    return this.programs.create(values as never, { transaction });
  }

  createLifts(rows: Array<Partial<ProgramLiftTargetModel>>, transaction: Transaction) {
    return this.lifts.bulkCreate(rows as never[], { transaction });
  }

  createWeeks(rows: Array<Partial<ProgramWeekModel>>, transaction: Transaction) {
    return this.weeks.bulkCreate(rows as never[], { transaction });
  }

  listLifts(programId: string, transaction?: Transaction) {
    return this.lifts.findAll({ where: { programId }, transaction });
  }

  listWeeks(programId: string, transaction?: Transaction) {
    return this.weeks.findAll({ where: { programId }, order: [['weekNumber', 'ASC']], transaction });
  }

  findWeek(programId: string, weekNumber: number, transaction?: Transaction) {
    return this.weeks.findOne({ where: { programId, weekNumber }, transaction });
  }

  /** Semanas ya terminadas (por fecha) y todavía abiertas: lo que el cierre semanal debe procesar. */
  listOpenWeeksEndingBefore(programId: string, date: string) {
    return this.weeks.findAll({
      where: { programId, fulfilled: null, weekStart: { [Op.lt]: date } },
      order: [['weekNumber', 'ASC']],
    });
  }

  async closeProgram(
    program: TrainingProgramModel,
    status: 'FINISHED' | 'STOPPED',
    reason: NonNullable<TrainingProgramModel['closeReason']>,
    transaction: Transaction,
  ) {
    await program.update({ status, closeReason: reason, closedAt: new Date() }, { transaction });
  }
}
