import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { ExerciseModel } from '../exercises/exercise.model';
import { WorkoutSessionModel } from './workout-session.model';
import { WorkoutSetModel } from './workout-set.model';

@Table({ tableName: 'sesiones_ejercicios', underscored: true, timestamps: true })
export class WorkoutSessionExerciseModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => WorkoutSessionModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'sesion_id' })
  declare sesionId: string;

  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_id' })
  declare ejercicioId: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare orden: number;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'es_enfasis' })
  declare esEnfasis: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare nota: string | null;

  @BelongsTo(() => WorkoutSessionModel)
  declare sesion?: WorkoutSessionModel;

  @BelongsTo(() => ExerciseModel)
  declare ejercicio?: ExerciseModel;

  @HasMany(() => WorkoutSetModel)
  declare series?: WorkoutSetModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
