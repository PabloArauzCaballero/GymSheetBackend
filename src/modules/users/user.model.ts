import { Column, CreatedAt, DataType, Default, HasOne, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { UserRole, UserStatus } from '../../common/enums/domain.enums';
import { AnthropometricProfileModel } from '../profiles/anthropometric-profile.model';

/**
 * Persistence model for an application user.
 *
 * English property names are used in TypeScript while `field` preserves the
 * existing Spanish PostgreSQL schema during the hardening migration.
 */
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
  declare fullName: string;

  @Default(UserRole.CLIENTE)
  @Column({ type: DataType.ENUM(...Object.values(UserRole)), allowNull: false, field: 'rol' })
  declare role: UserRole;

  @Default(UserStatus.ACTIVO)
  @Column({ type: DataType.ENUM(...Object.values(UserStatus)), allowNull: false, field: 'estado' })
  declare status: UserStatus;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_registro' })
  declare registeredAt: Date;

  @HasOne(() => AnthropometricProfileModel)
  declare anthropometricProfile?: AnthropometricProfileModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
