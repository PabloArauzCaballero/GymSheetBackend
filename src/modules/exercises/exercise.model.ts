import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { ExerciseStatus, ExerciseType } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';
import { ExerciseEquipmentModel } from './exercise-equipment.model';

@Table({ tableName: 'ejercicios', underscored: true, timestamps: true })
export class ExerciseModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare nombre: string;

  @Column({ type: DataType.STRING(100), allowNull: false, field: 'grupo_muscular' })
  declare grupoMuscular: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare descripcion: string | null;

  @Column({ type: DataType.ENUM(...Object.values(ExerciseType)), allowNull: false, field: 'tipo_ejercicio' })
  declare tipoEjercicio: ExerciseType;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'created_by_usuario_id' })
  declare createdByUsuarioId: string | null;

  @Default(ExerciseStatus.ACTIVO)
  @Column({ type: DataType.ENUM(...Object.values(ExerciseStatus)), allowNull: false })
  declare estado: ExerciseStatus;

  @BelongsTo(() => UserModel)
  declare createdByUsuario?: UserModel;

  @HasMany(() => ExerciseEquipmentModel)
  declare equipos?: ExerciseEquipmentModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
