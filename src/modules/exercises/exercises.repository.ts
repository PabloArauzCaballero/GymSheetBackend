import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Includeable, Op, Transaction, WhereOptions, col, fn } from 'sequelize';
import {
  ExerciseMediaStatus,
  ExerciseStatus,
  ExerciseType,
} from '../../common/enums/domain.enums';
import { EquipmentModel } from '../equipment/equipment.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseMediaModel } from './exercise-media.model';
import { ExerciseModel } from './exercise.model';
import {
  CreateGlobalExerciseInput,
  ExerciseFilterInput,
  UpdateExerciseInput,
} from './exercises.schemas';
import { UserExerciseModel } from './user-exercise.model';

export type ExercisePageResult = {
  rows: ExerciseModel[];
  count: number;
};

@Injectable()
export class ExercisesRepository {
  constructor(
    @InjectModel(ExerciseModel)
    private readonly exerciseModel: typeof ExerciseModel,
    @InjectModel(ExerciseEquipmentModel)
    private readonly exerciseEquipmentModel: typeof ExerciseEquipmentModel,
    @InjectModel(UserExerciseModel)
    private readonly userExerciseModel: typeof UserExerciseModel,
  ) {}

  listVisibleForUser(
    userId: string,
    filters: ExerciseFilterInput,
  ): Promise<ExercisePageResult> {
    const where = this.buildVisibilityWhere(userId, filters);
    const offset = (filters.page - 1) * filters.pageSize;

    return this.exerciseModel.findAndCountAll({
      where,
      include: this.buildIncludes(filters.equipmentId, true),
      distinct: true,
      limit: filters.pageSize,
      offset,
      order: [['name', 'ASC']],
    });
  }

  /**
   * Taxonomía del catálogo: partes del cuerpo y, dentro de cada una, músculos
   * objetivo, con su conteo. Se resuelve con un GROUP BY en vez de traer los
   * ejercicios y agrupar en memoria — el catálogo ronda los 1300 registros y el
   * cliente sólo necesita las etiquetas para dibujar la navegación.
   */
  /**
   * Una imagen representativa por músculo.
   *
   * Las láminas del catálogo resaltan en rojo el músculo trabajado, así que
   * sirven como icono anatómico sin dibujar nada nuevo: es más reconocible que
   * un glifo genérico. `DISTINCT ON` deja que Postgres elija la primera fila
   * por grupo en una sola pasada, en vez de traer 1300 ejercicios y filtrarlos
   * en memoria.
   */
  async listTaxonomyImages(): Promise<
    Array<{ bodyPart: string; targetMuscle: string; imageUrl: string | null }>
  > {
    const [rows] = await this.exerciseModel.sequelize!.query(
      `SELECT DISTINCT ON (e.body_part, e.target_muscle)
         e.body_part   AS "bodyPart",
         e.target_muscle AS "targetMuscle",
         m.url         AS "imageUrl"
       FROM public.ejercicios e
       JOIN training.exercise_media m ON m.ejercicio_id = e.id
       WHERE e.estado = 'ACTIVO'
         AND e.body_part IS NOT NULL
         AND e.target_muscle IS NOT NULL
         AND m.status = 'ACTIVE'
       ORDER BY e.body_part, e.target_muscle, m.is_primary DESC, m.sort_order ASC`,
    );
    return rows as Array<{
      bodyPart: string;
      targetMuscle: string;
      imageUrl: string | null;
    }>;
  }

  async listTaxonomy(): Promise<
    Array<{ bodyPart: string; targetMuscle: string; total: number }>
  > {
    const rows = await this.exerciseModel.findAll({
      attributes: [
        "bodyPart",
        "targetMuscle",
        [fn("COUNT", col("id")), "total"],
      ],
      where: {
        status: ExerciseStatus.ACTIVE,
        bodyPart: { [Op.ne]: null },
        targetMuscle: { [Op.ne]: null },
      },
      group: ["body_part", "target_muscle"],
      order: [
        ["bodyPart", "ASC"],
        ["targetMuscle", "ASC"],
      ],
      raw: true,
    });
    // `raw: true` devuelve las columnas sin tipar, y el nombre depende de si
    // gana el alias del atributo (camelCase) o la columna física del GROUP BY
    // (snake_case); de ahí que `readText` consulte ambas formas.
    return (rows as unknown as Array<Record<string, unknown>>).map((row) => ({
      bodyPart: readText(row, "bodyPart", "body_part"),
      targetMuscle: readText(row, "targetMuscle", "target_muscle"),
      total: Number(row["total"] ?? 0),
    }));
  }

  findVisibleById(exerciseId: string, userId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: {
        id: exerciseId,
        status: ExerciseStatus.ACTIVE,
        [Op.or]: [
          { type: ExerciseType.GLOBAL },
          { type: ExerciseType.PERSONAL, createdByUserId: userId },
        ],
      },
      include: this.buildIncludes(undefined, false),
    });
  }

  findGlobalById(exerciseId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: {
        id: exerciseId,
        type: ExerciseType.GLOBAL,
        status: ExerciseStatus.ACTIVE,
      },
      include: this.buildIncludes(undefined, false),
    });
  }

  createGlobal(
    input: CreateGlobalExerciseInput,
    transaction?: Transaction,
  ): Promise<ExerciseModel> {
    return this.exerciseModel.create(
      {
        ...this.toExerciseAttributes(input),
        type: ExerciseType.GLOBAL,
        createdByUserId: null,
      },
      { transaction },
    );
  }

  /**
   * Recibe la forma ya resuelta, no la del formulario: cuando el alta llega con
   * un músculo en vez de un grupo, el servicio ya ha consultado la taxonomía y
   * ha rellenado grupo, músculo objetivo y equipamiento antes de llegar aquí.
   */
  createPersonal(
    userId: string,
    input: CreateGlobalExerciseInput & { requiredEquipment?: string | null },
    transaction?: Transaction,
  ): Promise<ExerciseModel> {
    return this.exerciseModel.create(
      {
        ...this.toExerciseAttributes(input),
        type: ExerciseType.PERSONAL,
        createdByUserId: userId,
      },
      { transaction },
    );
  }

  async replaceExerciseEquipment(
    exerciseId: string,
    equipmentIds: string[],
    transaction?: Transaction,
  ): Promise<void> {
    await this.exerciseEquipmentModel.destroy({
      where: { exerciseId },
      transaction,
    });

    if (equipmentIds.length === 0) {
      return;
    }

    await this.exerciseEquipmentModel.bulkCreate(
      equipmentIds.map((equipmentId) => ({ exerciseId, equipmentId })),
      { transaction },
    );
  }

  async updateExercise(
    exercise: ExerciseModel,
    input: UpdateExerciseInput,
    transaction?: Transaction,
  ): Promise<ExerciseModel> {
    const { equipmentIds: _equipmentIds, ...changes } = input;
    await exercise.update(changes, { transaction });
    return exercise;
  }

  async markInactive(exercise: ExerciseModel): Promise<ExerciseModel> {
    await exercise.update({ status: ExerciseStatus.INACTIVE });
    return exercise;
  }

  findFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel | null> {
    return this.userExerciseModel.findOne({ where: { userId, exerciseId } });
  }

  listFavorites(userId: string): Promise<UserExerciseModel[]> {
    return this.userExerciseModel.findAll({
      where: { userId },
      include: [
        {
          model: ExerciseModel,
          required: true,
          where: { status: ExerciseStatus.ACTIVE },
          include: this.buildIncludes(undefined, true),
        },
      ],
      order: [['selectedAt', 'DESC']],
    });
  }

  createFavorite(userId: string, exerciseId: string): Promise<UserExerciseModel> {
    return this.userExerciseModel.create({ userId, exerciseId });
  }

  deleteFavorite(userId: string, exerciseId: string): Promise<number> {
    return this.userExerciseModel.destroy({ where: { userId, exerciseId } });
  }

  private buildVisibilityWhere(
    userId: string,
    filters: ExerciseFilterInput,
  ): WhereOptions {
    const conditions: WhereOptions[] = [
      {
        [Op.or]: [
          { type: ExerciseType.GLOBAL },
          { type: ExerciseType.PERSONAL, createdByUserId: userId },
        ],
      },
    ];

    if (filters.search) {
      conditions.push({
        [Op.or]: [
          { name: { [Op.iLike]: `%${filters.search}%` } },
          { description: { [Op.iLike]: `%${filters.search}%` } },
        ],
      });
    }

    return {
      status: ExerciseStatus.ACTIVE,
      ...(filters.muscleGroup ? { muscleGroup: filters.muscleGroup } : {}),
      ...(filters.bodyPart ? { bodyPart: filters.bodyPart } : {}),
      ...(filters.targetMuscle ? { targetMuscle: filters.targetMuscle } : {}),
      ...(filters.dataSource ? { dataSource: filters.dataSource } : {}),
      [Op.and]: conditions,
    };
  }

  private buildIncludes(
    equipmentId: string | undefined,
    primaryMediaOnly: boolean,
  ): Includeable[] {
    return [
      {
        model: ExerciseEquipmentModel,
        required: Boolean(equipmentId),
        where: equipmentId ? { equipmentId } : undefined,
        include: [{ model: EquipmentModel, required: false }],
      },
      {
        model: ExerciseMediaModel,
        required: false,
        separate: true,
        where: {
          status: ExerciseMediaStatus.ACTIVE,
          ...(primaryMediaOnly ? { isPrimary: true } : {}),
        },
        order: [
          ['isPrimary', 'DESC'],
          ['sortOrder', 'ASC'],
        ],
      },
    ];
  }

  private toExerciseAttributes<T extends CreateGlobalExerciseInput>(
    input: T,
  ): Omit<T, 'equipmentIds'> {
    const { equipmentIds: _equipmentIds, ...attributes } = input;
    return attributes;
  }
}

/**
 * Lee una columna de texto de una fila cruda.
 *
 * Sequelize devuelve las agregaciones sin pasar por el modelo, así que la clave
 * llega en camelCase o en snake_case según el dialecto y el valor es `unknown`.
 * Se acepta sólo texto: convertir a ciegas con `String()` produciría
 * «[object Object]» como nombre de grupo muscular si alguna vez llegase otra
 * cosa, y ese valor terminaría en un filtro de la interfaz sin que nadie
 * entendiera de dónde salió.
 */
function readText(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): string {
  const value = row[camelKey] ?? row[snakeKey];
  return typeof value === "string" ? value : "";
}
