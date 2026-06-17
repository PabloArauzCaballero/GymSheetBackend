import { Column, CreatedAt, DataType, Default, HasOne, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { UserRole, UserStatus } from '../../common/enums/domain.enums';
import { AnthropometricProfileModel } from '../profiles/anthropometric-profile.model';

@Table({ tableName: 'usuarios', underscored: true, timestamps: true })
export class UserModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(180), allowNull: false, unique: true })
  declare email: string;

  @Column({ type: DataType.STRING(255), allowNull: false, field: 'password_hash' })
  declare passwordHash: string;

  @Column({ type: DataType.STRING(180), allowNull: false, field: 'nombre_completo' })
  declare nombreCompleto: string;

  @Default(UserRole.CLIENTE)
  @Column({ type: DataType.ENUM(...Object.values(UserRole)), allowNull: false })
  declare rol: UserRole;

  @Default(UserStatus.ACTIVO)
  @Column({ type: DataType.ENUM(...Object.values(UserStatus)), allowNull: false })
  declare estado: UserStatus;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_registro' })
  declare fechaRegistro: Date;

  @HasOne(() => AnthropometricProfileModel)
  declare perfilAntropometrico?: AnthropometricProfileModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
