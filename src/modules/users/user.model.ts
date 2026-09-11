import { Column, CreatedAt, DataType, Default, HasOne, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { UserGender, UserRole, UserStatus } from '../../common/enums/domain.enums';
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

  @Default(UserRole.CLIENT)
  @Column({ type: DataType.ENUM(...Object.values(UserRole)), allowNull: false, field: 'rol' })
  declare role: UserRole;

  @Default(UserStatus.ACTIVE)
  @Column({ type: DataType.ENUM(...Object.values(UserStatus)), allowNull: false, field: 'estado' })
  declare status: UserStatus;

  /**
   * Gimnasio al que pertenece la cuenta. Nulo en una instalación de un solo
   * gimnasio, donde el cliente usa la identidad de referencia: no es un dato
   * que falte, es uno que no aplica.
   *
   * 60 y no 40: la columna la crea `202608180001-user-tenant`, la primera de
   * las dos migraciones paralelas que la añadieron, y es la que gana en una
   * base nueva.
   */
  @Column({ type: DataType.STRING(60), allowNull: true, field: 'tenant_id' })
  declare tenantId: string | null;

  /**
   * Género declarado por la persona. Nulo es un estado legítimo y permanente:
   * la progresión tiene una rama neutra para quien no quiera declararlo.
   */
  @Column({ type: DataType.STRING(12), allowNull: true, field: 'genero' })
  declare gender: UserGender | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'fecha_registro' })
  declare registeredAt: Date;

  /**
   * Cuándo aceptó los términos y la política de privacidad vigentes. Nulo solo
   * en cuentas anteriores a que este campo existiera.
   */
  @Column({ type: DataType.DATE, allowNull: true, field: 'accepted_terms_at' })
  declare acceptedTermsAt: Date | null;

  /** Versión de los términos que aceptó, no la vigente hoy. */
  @Column({ type: DataType.STRING(20), allowNull: true, field: 'terms_version' })
  declare termsVersion: string | null;

  /** Cuánto suma cada toque de un chip rápido al registrar una serie. */
  @Default('2.5')
  @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, field: 'weight_increment_kg' })
  declare weightIncrementKg: string;

  /** Sucursal habitual. Nula si la cuenta no tiene una sede asignada. */
  @Column({ type: DataType.UUID, allowNull: true, field: 'sede_id' })
  declare branchId: string | null;

  /**
   * Cuándo se cerró el último socket de chat activo. Nula mientras haya uno
   * abierto (la persona está en línea) o si nunca abrió el chat.
   */
  @Column({ type: DataType.DATE, allowNull: true, field: 'last_seen_at' })
  declare lastSeenAt: Date | null;

  @HasOne(() => AnthropometricProfileModel)
  declare anthropometricProfile?: AnthropometricProfileModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
