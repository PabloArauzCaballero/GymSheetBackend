import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { CardioPlanModel } from './cardio-plan.model';
import { maxHeartRate } from './engine/cardio';
import { CardioPlanInput, CardioPlanPatch } from './cardio.schemas';

export type CardioPlanView = {
  id: string;
  nombre: string;
  modalidad: string;
  diasSemana: number[];
  minutosObjetivo: number;
  intensidad: { tipo: string; zona: number | null; rpe: number | null };
  intervalos: CardioPlanModel['intervals'];
  fcReposo: number | null;
  fcMax: number | null;
  progresionPctSemana: number;
};

@Injectable()
export class CardioPlansService {
  constructor(@InjectModel(CardioPlanModel) private readonly plans: typeof CardioPlanModel) {}

  async create(userId: string, input: CardioPlanInput): Promise<CardioPlanView> {
    const plan = await this.plans.create({
      userId,
      ...input,
      maxHeartRate: input.maxHeartRate ?? (await this.estimatedMaxHeartRate(userId)),
    });
    return this.toView(plan);
  }

  async list(userId: string): Promise<CardioPlanView[]> {
    const rows = await this.plans.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
    return rows.map((r) => this.toView(r));
  }

  async update(userId: string, id: string, patch: CardioPlanPatch): Promise<CardioPlanView> {
    const plan = await this.owned(userId, id);
    await plan.update(patch);
    return this.toView(plan);
  }

  async owned(userId: string, id: string): Promise<CardioPlanModel> {
    const plan = await this.plans.findByPk(id);
    if (!plan || plan.userId !== userId) throw new NotFoundException('Plan de cardio no encontrado.');
    return plan;
  }

  /** FC máxima de Tanaka con la edad del perfil (fecha de nacimiento, o la edad guardada). */
  async estimatedMaxHeartRate(userId: string): Promise<number | null> {
    const [row] = await this.plans.sequelize!.query<{ age: number | null }>(
      `SELECT COALESCE(date_part('year', age(fecha_nacimiento))::int, edad) AS age
         FROM public.perfiles_antropometricos WHERE usuario_id = :userId`,
      { type: QueryTypes.SELECT, replacements: { userId } },
    );
    return row?.age ? maxHeartRate(row.age) : null;
  }

  toView(plan: CardioPlanModel): CardioPlanView {
    return {
      id: plan.id,
      nombre: plan.name,
      modalidad: plan.modality,
      diasSemana: plan.weekdays,
      minutosObjetivo: plan.targetMinutes,
      intensidad: { tipo: plan.intensityType, zona: plan.targetZone, rpe: plan.targetRpe },
      intervalos: plan.intervals,
      fcReposo: plan.restingHeartRate,
      fcMax: plan.maxHeartRate,
      progresionPctSemana: plan.weeklyProgressionPct,
    };
  }
}
