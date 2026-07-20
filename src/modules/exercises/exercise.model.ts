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
  ExerciseDataSource,
  ExerciseStatus,
  ExerciseType,
} from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';
import { ExerciseMediaModel } from './exercise-media.model';

export type LocalizedInstructions = Record<string, string>;
export type LocalizedInstructionSteps = Record<string, string[]>;

/**
 * Exercise aggregate root. Existing database columns remain compatible while
 * the application layer uses English identifiers and supports provenance,
 * multilingual instructions, equipment taxonomy, and multiple media assets.
 */
@Table({ tableName: 'ejercicios', underscored: true, timestamps: true })
export class ExerciseModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(160), allowNull: false, field: 'nombre' })
  declare name: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'grupo_muscular' })
  declare muscleGroup: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'descripcion' })
  declare description: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ExerciseType)),
    allowNull: false,
    field: 'tipo_ejercicio',
  })
  declare type: ExerciseType;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'created_by_usuario_id' })
  declare createdByUserId: string | null;

  @Default(ExerciseStatus.ACTIVE)
  @Column({
    type: DataType.ENUM(...Object.values(ExerciseStatus)),
    allowNull: false,
    field: 'estado',
  })
  declare status: ExerciseStatus;

  @Default(ExerciseDataSource.CUSTOM)
  @Column({ type: DataType.STRING(60), allowNull: false, field: 'data_source' })
  declare dataSource: ExerciseDataSource;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'external_id' })
  declare externalId: string | null;

  @Column({ type: DataType.STRING(80), allowNull: true, field: 'external_version' })
  declare externalVersion: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'source_url' })
  declare sourceUrl: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'source_license' })
  declare sourceLicense: string | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'source_attribution' })
  declare sourceAttribution: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'category' })
  declare category: string | null;

  @Column({ type: DataType.STRING(100), allowNull: true, field: 'body_part' })
  declare bodyPart: string | null;

  @Column({ type: DataType.STRING(160), allowNull: true, field: 'required_equipment' })
  declare requiredEquipment: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'target_muscle' })
  declare targetMuscle: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true, field: 'synergist_muscle_group' })
  declare synergistMuscleGroup: string | null;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false, field: 'secondary_muscles' })
  declare secondaryMuscles: string[];

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'instructions' })
  declare instructions: LocalizedInstructions;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'instruction_steps' })
  declare instructionSteps: LocalizedInstructionSteps;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false, field: 'metadata' })
  declare metadata: Record<string, unknown>;

  @Column({ type: DataType.DATE, allowNull: true, field: 'imported_at' })
  declare importedAt: Date | null;

  @BelongsTo(() => UserModel)
  declare createdByUser?: UserModel;

  @HasMany(() => ExerciseEquipmentModel)
  declare equipmentLinks?: ExerciseEquipmentModel[];

  @HasMany(() => ExerciseMediaModel)
  declare media?: ExerciseMediaModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
