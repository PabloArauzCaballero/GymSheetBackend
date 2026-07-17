import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { TrainingGoal } from '../../common/enums/domain.enums';
import { UserModel } from '../users/user.model';

/** Anthropometric values supplied by a user for training personalization. */
@Table({ tableName: 'perfiles_antropometricos', underscored: true, timestamps: true })
export class AnthropometricProfileModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'usuario_id' })
  declare userId: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'edad' })
  declare age: number;

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: false, field: 'peso_kg' })
  declare weightKg: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'estatura_cm' })
  declare heightCm: number;

  @Column({
    type: DataType.ENUM(...Object.values(TrainingGoal)),
    allowNull: false,
    field: 'objetivo',
  })
  declare goal: TrainingGoal;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_actualizacion' })
  declare measurementUpdatedAt: Date;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
