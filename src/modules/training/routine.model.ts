import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import {
  RoutineStatus,
  RoutineVisibility,
  TrainingGoal,
} from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { RoutineDayModel } from './routine-day.model';
import { RoutineExerciseModel } from './routine-exercise.model';

/** Autoría congelada al copiar una rutina (sobrevive aunque el original desaparezca). */
export type RoutineAttribution = {
  routineName: string;
  authorId: string | null;
  authorName: string;
};

/**
 * A reusable training plan (rutina). Owned by the user that created it — a coach
 * building plans for clients, or a client building their own. Visibility controls
 * whether it is private, shared with assignees, or a public template.
 */
@Table({
  tableName: 'routines',
  schema: 'training',
  underscored: true,
  timestamps: true,
})
export class RoutineModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(160), allowNull: false, field: 'nombre' })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'descripcion' })
  declare description: string | null;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'created_by_user_id' })
  declare createdByUserId: string;

  @Default(RoutineVisibility.PRIVATE)
  @Column({
    type: DataType.ENUM(...Object.values(RoutineVisibility)),
    allowNull: false,
    field: 'visibilidad',
  })
  declare visibility: RoutineVisibility;

  @Column({
    type: DataType.ENUM(...Object.values(TrainingGoal)),
    allowNull: true,
    field: 'objetivo',
  })
  declare goal: TrainingGoal | null;

  @Default(RoutineStatus.ACTIVE)
  @Column({
    type: DataType.ENUM(...Object.values(RoutineStatus)),
    allowNull: false,
    field: 'estado',
  })
  declare status: RoutineStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'metadata' })
  declare metadata: Record<string, unknown>;

  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'duracion_semanas' })
  declare durationWeeks: number | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'es_oficial' })
  declare isOfficial: boolean;

  @Column({ type: DataType.UUID, allowNull: true, field: 'basada_en_rutina_id' })
  declare basedOnRoutineId: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'basada_en_version' })
  declare basedOnVersion: number | null;

  @Column({ type: DataType.JSONB, allowNull: true, field: 'atribucion' })
  declare attribution: RoutineAttribution | null;

  @Default(1)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'version' })
  declare version: number;

  /** «vN» de una copia propia (C2): 1 + copias previas del mismo original por el mismo usuario. */
  @Column({ type: DataType.SMALLINT, allowNull: true, field: 'numero_copia' })
  declare copyNumber: number | null;

  @Column({ type: DataType.CHAR(64), allowNull: true, field: 'huella' })
  declare fingerprint: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'publicada_en' })
  declare publishedAt: Date | null;

  @Default('VISIBLE')
  @Column({ type: DataType.STRING(20), allowNull: false, field: 'estado_moderacion' })
  declare moderationState: 'VISIBLE' | 'OCULTA_AUTO' | 'OCULTA_MODERACION';

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'progresion_config' })
  declare progressionConfig: Record<string, unknown>;

  @Column({ type: DataType.STRING(60), allowNull: true, field: 'tenant_id_autor' })
  declare authorTenantId: string | null;

  @Column({ type: DataType.DECIMAL(3, 2), allowNull: true, field: 'valoracion_promedio' })
  declare ratingAverage: string | null;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'valoracion_total' })
  declare ratingCount: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'copias_total' })
  declare copiesCount: number;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'activaciones_total' })
  declare activationsCount: number;

  @HasMany(() => RoutineDayModel)
  declare days?: RoutineDayModel[];

  @BelongsTo(() => UserModel)
  declare createdBy?: UserModel;

  @HasMany(() => RoutineExerciseModel)
  declare exercises?: RoutineExerciseModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
