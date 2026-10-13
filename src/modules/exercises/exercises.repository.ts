import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Includeable, Op, QueryTypes, Transaction, WhereOptions, col, fn } from 'sequelize';
import {
  ExerciseMediaStatus,
  ExerciseStatus,
  ExerciseType,
} from '../../common/enums/domain.enums';
import { EquipmentModel } from '../equipment/equipment.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseMediaModel } from './exercise-media.model';
import { ExerciseModel } from './exercise.model';
import { expandFilterTerm, SearchPlan, significantWords } from './exercise-search';
import {
  CreateGlobalExerciseInput,
  ExerciseFilterInput,
  ExerciseOrder,
  UpdateExerciseInput,
} from './exercises.schemas';
import { UserExerciseModel } from './user-exercise.model';

export type ExercisePageResult = {
  rows: ExerciseModel[];
  count: number;
};

/**
 * Umbral de `word_similarity` para dar por encontrada una palabra de la
 * consulta. 0,5 deja pasar una errata por palabra («sentadiya», «mancuernaz»)
 * sin emparejar palabras distintas que solo comparten el principio.
 */
const WORD_MATCH_THRESHOLD = 0.5;

/** Con tres letras o menos los trigramas no distinguen nada: se exige el principio de una palabra. */
const SHORT_WORD_LENGTH = 3;

/** Lo que vale teclear solo el principio de una palabra («sentad») frente a la palabra entera. */
const PREFIX_MATCH_SCORE = 0.93;

/** Lo que cuenta coincidir en músculo o equipo frente a coincidir en el nombre. */
const EXTRA_FIELD_WEIGHT = 0.8;

/**
 * Solo se devuelven los ejercicios cuyo acierto queda a esta distancia del
 * mejor. Si alguien escribe «sentadilla» bien, no quiere ver «sentado»; si la
 * escribe mal, el mejor acierto baja y con él el listón.
 */
const RELATIVE_MATCH_MARGIN = 0.12;

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
   * Lista con búsqueda tolerante, filtros de texto libre u orden distinto del
   * alfabético (D8).
   *
   * Primero se resuelven los ids de la página en una consulta con `pg_trgm`
   * (puntuación, filtros, total) y después se cargan esas filas con sus
   * relaciones: mezclar las dos cosas obligaría a ordenar por una expresión a
   * través de los `include`, que Sequelize pagina mal.
   */
  async searchVisibleForUser(
    userId: string,
    filters: ExerciseFilterInput,
    plan: SearchPlan | null,
    order: ExerciseOrder,
  ): Promise<ExercisePageResult> {
    const replacements: Record<string, unknown> = {
      userId,
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
    };
    const where: string[] = [
      `e.estado = 'ACTIVO'`,
      `(e.tipo_ejercicio = 'GLOBAL' OR (e.tipo_ejercicio = 'PERSONAL' AND e.created_by_usuario_id = :userId))`,
    ];
    const exact = (column: string, key: string, value: string | undefined) => {
      if (!value) return;
      replacements[key] = value;
      where.push(`e.${column} = :${key}`);
    };
    exact('grupo_muscular', 'muscleGroup', filters.muscleGroup);
    exact('body_part', 'bodyPart', filters.bodyPart);
    exact('target_muscle', 'targetMuscle', filters.targetMuscle);
    exact('data_source', 'dataSource', filters.dataSource);
    if (filters.equipmentId) {
      replacements.equipmentId = filters.equipmentId;
      where.push(
        `EXISTS (SELECT 1 FROM public.ejercicios_equipos ee WHERE ee.ejercicio_id = e.id AND ee.equipo_gym_id = :equipmentId)`,
      );
    }
    if (filters.favoritos) {
      where.push(
        `EXISTS (SELECT 1 FROM training.user_exercise_preferences p
                  WHERE p.ejercicio_id = e.id AND p.usuario_id = :userId AND p.is_favorite = true)`,
      );
    }
    const textFilter = (expression: string, key: string, raw: string | undefined) => {
      const terms = raw ? expandFilterTerm(raw) : [];
      if (terms.length === 0) return;
      replacements[key] = terms.map((term) => `%${term}%`);
      where.push(`${expression} LIKE ANY (ARRAY[:${key}])`);
    };
    textFilter(`public.repp_normalize(coalesce(e.required_equipment, ''))`, 'equipmentTerms', filters.equipmentText);
    textFilter(
      `public.repp_normalize(concat_ws(' ', e.target_muscle, e.grupo_muscular, e.body_part))`,
      'muscleTerms',
      filters.muscleText,
    );
    if (filters.withImage) where.push(`${HAS_STILL_SQL}`);

    // Cada grupo de la consulta debe encontrarse (con tolerancia) en el ejercicio.
    // Una alternativa de varias palabras («press de banca») exige TODAS sus
    // palabras, cada una con tolerancia; el grupo vale lo que su mejor alternativa.
    //
    // Cada palabra aporta dos cosas: una CONDICIÓN que el índice GIN de
    // trigramas resuelve (descarta casi todo el catálogo sin calcular nada) y
    // una PUNTUACIÓN que solo se calcula para lo que pasó el filtro. Puntuar
    // las 1.300 filas costaba ~12 ms por palabra; así son décimas.
    const groupScores: string[] = [];
    const groupConditions: string[] = [];
    const wordSets: string[] = [];
    let wordIndex = 0;
    const wordMatch = (word: string): { score: string; condition: string } => {
      const key = `w${(wordIndex += 1)}`;
      replacements[`${key}p`] = `% ${word}%`;
      const prefix = `(' ' || e.busqueda) LIKE :${key}p`;
      const prefixExtra = `(' ' || e.busqueda_extra) LIKE :${key}p`;
      if (word.length <= SHORT_WORD_LENGTH) {
        return {
          score: `(CASE WHEN ${prefix} THEN 1.0 WHEN ${prefixExtra} THEN ${EXTRA_FIELD_WEIGHT} ELSE 0 END)`,
          condition: `(${prefix} OR ${prefixExtra})`,
        };
      }
      replacements[key] = word;
      replacements[`${key}s`] = `%${word}%`;
      // Una CTE por palabra con predicados sueltos: escritos como un OR dentro
      // del WHERE general, el planificador prefiere recorrer la tabla entera.
      wordSets.push(`${key} AS MATERIALIZED (
         SELECT id FROM public.ejercicios WHERE :${key} <% busqueda
         UNION SELECT id FROM public.ejercicios WHERE :${key} <% busqueda_extra
         UNION SELECT id FROM public.ejercicios WHERE busqueda LIKE :${key}s
       )`);
      return {
        // Principio de palabra («sentad» mientras se teclea) casi como palabra entera.
        score: `GREATEST(CASE WHEN ${prefix} THEN ${PREFIX_MATCH_SCORE} ELSE 0 END,
                         word_similarity(:${key}, e.busqueda),
                         ${EXTRA_FIELD_WEIGHT} * word_similarity(:${key}, e.busqueda_extra))`,
        condition: `e.id IN (SELECT id FROM ${key})`,
      };
    };
    for (const group of plan?.groups ?? []) {
      const alternatives = group.alternatives
        .map((alternative) => significantWords(alternative))
        .filter((words) => words.length > 0)
        .map((words) => {
          const matches = words.map(wordMatch);
          return {
            score: matches.length === 1 ? matches[0].score : `LEAST(${matches.map((m) => m.score).join(', ')})`,
            condition: matches.map((m) => m.condition).join(' AND '),
          };
        });
      if (alternatives.length === 0) continue;
      groupScores.push(
        alternatives.length === 1 ? alternatives[0].score : `GREATEST(${alternatives.map((a) => a.score).join(', ')})`,
      );
      groupConditions.push(`(${alternatives.map((a) => `(${a.condition})`).join(' OR ')})`);
    }
    where.push(...groupConditions);

    const usage =
      order === 'recientes' || order === 'masUsados'
        ? `JOIN (${USER_USAGE_SQL}) uso ON uso.ejercicio_id = e.id`
        : '';
    const popularity = order === 'populares' ? `LEFT JOIN (${GLOBAL_USAGE_SQL}) pop ON pop.ejercicio_id = e.id` : '';

    const hasQuery = groupScores.length > 0;
    if (hasQuery) replacements.fullQuery = plan!.normalized;
    const scored = groupScores.map((expression, index) => `${expression} AS s${index}`).join(',\n             ');
    const allMatch = groupScores.map((_, index) => `s${index} >= ${WORD_MATCH_THRESHOLD}`).join(' AND ');
    const average = hasQuery
      ? `((${groupScores.map((_, index) => `s${index}`).join(' + ')}) / ${groupScores.length})`
      : '0';

    const orderBy: Record<ExerciseOrder, string> = {
      relevancia: hasQuery
        ? `relevancia DESC, tiene_imagen DESC, length(busqueda) ASC, nombre ASC`
        : `nombre ASC`,
      nombre: `nombre ASC`,
      populares: `me_gusta_total DESC, usos DESC, valoracion_total DESC, tiene_imagen DESC, nombre ASC`,
      recientes: `ultimo_uso DESC, nombre ASC`,
      masUsados: `sesiones DESC, ultimo_uso DESC, nombre ASC`,
    };

    const sql = `WITH ${wordSets.map((set) => `${set},\n       `).join('')}candidatos AS (
         SELECT e.id, e.nombre, e.busqueda, e.me_gusta_total, e.valoracion_total,
                ${HAS_STILL_SQL} AS tiene_imagen,
                ${order === 'populares' ? 'COALESCE(pop.usos, 0)' : '0'} AS usos,
                ${usage ? 'uso.ultimo_uso, uso.sesiones' : 'NULL::timestamptz AS ultimo_uso, 0 AS sesiones'}
                ${hasQuery ? `,\n             ${scored}` : ''}
           FROM public.ejercicios e
           ${usage}
           ${popularity}
          WHERE ${where.join('\n            AND ')}
       ),
       encontrados AS (
         SELECT *, ${average} AS acierto
           FROM candidatos
          ${hasQuery ? `WHERE ${allMatch}` : ''}
       ),
       puntuados AS (
         SELECT *,
                ${
                  hasQuery
                    ? `(acierto
                        + 0.15 * word_similarity(:fullQuery, busqueda)
                        + CASE WHEN busqueda LIKE :fullQuery || '%' THEN 0.10 ELSE 0 END
                        + 0.02 * ln(1 + me_gusta_total))`
                    : '0'
                } AS relevancia
           FROM encontrados
          ${hasQuery ? `WHERE acierto >= (SELECT max(acierto) FROM encontrados) - ${RELATIVE_MATCH_MARGIN}` : ''}
       )
       SELECT id, count(*) OVER () AS total
         FROM puntuados
        ORDER BY ${orderBy[order]}
        LIMIT :limit OFFSET :offset`;
    // El operador `<%` usa el umbral de la sesión: se fija solo para esta consulta.
    const sequelize = this.exerciseModel.sequelize!;
    const rows = await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `SET LOCAL pg_trgm.word_similarity_threshold = ${WORD_MATCH_THRESHOLD}`,
        { transaction },
      );
      return sequelize.query<{ id: string; total: string }>(sql, {
        type: QueryTypes.SELECT,
        replacements,
        transaction,
      });
    });

    const ids = rows.map((row) => row.id);
    const total = Number(rows[0]?.total ?? 0);
    if (ids.length === 0) {
      // Página más allá del final: el total sigue haciendo falta para paginar.
      return { rows: [], count: filters.page > 1 ? await this.countOnly(userId, filters, plan, order) : 0 };
    }
    return { rows: await this.findByIdsInOrder(ids), count: total };
  }

  /** Total de la misma búsqueda cuando la página pedida no tiene filas. */
  private async countOnly(
    userId: string,
    filters: ExerciseFilterInput,
    plan: SearchPlan | null,
    order: ExerciseOrder,
  ): Promise<number> {
    const first = await this.searchVisibleForUser(userId, { ...filters, page: 1, pageSize: 1 }, plan, order);
    return first.count;
  }

  /** Carga los ejercicios con sus relaciones, en el orden de `ids`. */
  async findByIdsInOrder(ids: readonly string[]): Promise<ExerciseModel[]> {
    if (ids.length === 0) return [];
    const models = await this.exerciseModel.findAll({
      where: { id: { [Op.in]: [...ids] } },
      include: this.buildIncludes(undefined, true),
    });
    const byId = new Map(models.map((model) => [model.id, model]));
    return ids.map((id) => byId.get(id)).filter((model): model is ExerciseModel => Boolean(model));
  }

  /**
   * Mejor imagen fija de cada ejercicio: su lámina más ancha o, si no tiene, el
   * póster de su vídeo. Los ejercicios sin imagen no aparecen en el mapa.
   */
  async findStills(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.exerciseModel.sequelize!.query<{ ejercicio_id: string; url: string }>(
      `SELECT DISTINCT ON (m.ejercicio_id) m.ejercicio_id,
              CASE WHEN m.media_type = 'IMAGE' THEN m.url ELSE m.thumbnail_url END AS url
         FROM training.exercise_media m
        WHERE m.status = 'ACTIVE'
          AND (m.media_type = 'IMAGE' OR (m.media_type = 'VIDEO' AND m.thumbnail_url IS NOT NULL))
          AND m.ejercicio_id IN (:ids)
        ORDER BY m.ejercicio_id, (m.media_type = 'IMAGE') DESC, m.width DESC NULLS LAST, m.is_primary DESC, m.sort_order`,
      { type: QueryTypes.SELECT, replacements: { ids: [...ids] } },
    );
    return new Map(rows.map((row) => [row.ejercicio_id, row.url]));
  }

  /** Nombres visibles del catálogo, para el vocabulario de «¿Quisiste decir…?». */
  async listSearchNames(): Promise<string[]> {
    const rows = await this.exerciseModel.sequelize!.query<{ texto: string }>(
      `SELECT concat_ws(' ', e.nombre_es, e.nombre, e.alias_busqueda) AS texto
         FROM public.ejercicios e
        WHERE e.estado = 'ACTIVO' AND e.tipo_ejercicio = 'GLOBAL'`,
      { type: QueryTypes.SELECT },
    );
    return rows.map((row) => row.texto);
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

  /** Para la ficha de un ejercicio privado ajeno ya autorizado por `ExerciseCommunityService`. */
  findByIdAnyOwner(exerciseId: string): Promise<ExerciseModel | null> {
    return this.exerciseModel.findOne({
      where: { id: exerciseId, status: ExerciseStatus.ACTIVE },
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

    if (filters.favoritos) {
      conditions.push({
        id: {
          [Op.in]: this.exerciseModel.sequelize!.literal(
            `(SELECT ejercicio_id FROM training.user_exercise_preferences
               WHERE usuario_id = ${this.exerciseModel.sequelize!.escape(userId)} AND is_favorite = true)`,
          ),
        },
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

/** El ejercicio tiene alguna imagen fija (lámina o póster de vídeo). */
const HAS_STILL_SQL = `EXISTS (SELECT 1 FROM training.exercise_media m
          WHERE m.ejercicio_id = e.id AND m.status = 'ACTIVE'
            AND (m.media_type = 'IMAGE' OR (m.media_type = 'VIDEO' AND m.thumbnail_url IS NOT NULL)))`;

/**
 * Ejercicios que la persona ha registrado de verdad (con alguna serie), con su
 * último uso y en cuántas sesiones. Las sesiones canceladas no cuentan.
 */
const USER_USAGE_SQL = `SELECT se.ejercicio_id,
                MAX(s.fecha_inicio) AS ultimo_uso,
                COUNT(DISTINCT s.id) AS sesiones
           FROM public.sesiones_ejercicios se
           JOIN public.sesiones_entrenamiento s ON s.id = se.sesion_id
          WHERE s.usuario_id = :userId
            AND s.estado <> 'CANCELADA'
            AND EXISTS (SELECT 1 FROM public.series_entrenamiento st WHERE st.sesion_ejercicio_id = se.id)
          GROUP BY se.ejercicio_id`;

/** Cuántas veces se ha puesto cada ejercicio en una sesión, en toda la plataforma. */
const GLOBAL_USAGE_SQL = `SELECT se.ejercicio_id, COUNT(*) AS usos
           FROM public.sesiones_ejercicios se
          GROUP BY se.ejercicio_id`;

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
