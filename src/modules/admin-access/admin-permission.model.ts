import { Column, CreatedAt, DataType, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';

/** Code-defined catalog row for a single granular admin permission (e.g. "catalog:read"). */
@Table({ tableName: 'permissions', schema: 'admin', underscored: true, timestamps: true })
export class AdminPermissionModel extends Model {
  @PrimaryKey
  @Column(DataType.STRING(80))
  declare key: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare label: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare domain: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
