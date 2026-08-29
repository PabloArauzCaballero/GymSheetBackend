import {
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";

/**
 * Catálogo de gimnasios.
 *
 * La clave primaria es el propio identificador legible (`topfitness`), no un
 * UUID: es la misma clave que ya viaja en `usuarios.tenant_id` y en la URL de
 * acceso de la web, así que darle un sustituto obligaría a traducir en cada
 * consulta y abriría la puerta a que dos grafías del mismo gimnasio convivan.
 */
@Table({
  tableName: "tenants",
  schema: "public",
  underscored: true,
  timestamps: true,
})
export class TenantModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.STRING(60) })
  declare id: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare nombre: string;

  /** `ACTIVO` | `INACTIVO`. Un gimnasio inactivo no admite altas nuevas. */
  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: "ACTIVO" })
  declare estado: string;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
