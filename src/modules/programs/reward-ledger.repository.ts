import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes, Transaction } from 'sequelize';
import { TrainingProgramModel } from './program.models';

export type LedgerEntry = {
  userId: string;
  programId: string;
  weekNumber: number;
  multiplier: number;
  basePoints: number;
  bonusPoints: number;
  reason: string;
};

/**
 * Libro de bonos de modo: solo se inserta. El índice único
 * (programa, semana, motivo) hace que un cierre repetido no pague dos veces.
 */
@Injectable()
export class RewardLedgerRepository {
  constructor(@InjectModel(TrainingProgramModel) private readonly programs: typeof TrainingProgramModel) {}

  /** `true` si se insertó; `false` si ya existía (idempotencia). */
  async append(entry: LedgerEntry, transaction?: Transaction): Promise<boolean> {
    const rows = await this.programs.sequelize!.query<{ id: string }>(
      `INSERT INTO training.mode_reward_ledger
         (usuario_id, program_id, semana_numero, multiplicador, puntos_base, puntos_bonus, motivo)
       VALUES (:userId, :programId, :weekNumber, :multiplier, :basePoints, :bonusPoints, :reason)
       ON CONFLICT (program_id, semana_numero, motivo) DO NOTHING
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: entry, transaction },
    );
    return rows.length > 0;
  }

  async totalBonus(userId: string): Promise<number> {
    const [row] = await this.programs.sequelize!.query<{ total: string }>(
      `SELECT COALESCE(SUM(puntos_bonus), 0) AS total FROM training.mode_reward_ledger WHERE usuario_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return Number(row?.total ?? 0);
  }

  listForProgram(programId: string) {
    return this.programs.sequelize!.query<{
      semana: number;
      motivo: string;
      multiplicador: string;
      puntosBase: number;
      puntosBonus: number;
      creadoEn: Date;
    }>(
      `SELECT semana_numero AS semana, motivo, multiplicador, puntos_base AS "puntosBase",
              puntos_bonus AS "puntosBonus", created_at AS "creadoEn"
         FROM training.mode_reward_ledger WHERE program_id = :programId ORDER BY semana_numero, created_at`,
      { type: QueryTypes.SELECT, replacements: { programId } },
    );
  }
}
