import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';

@Table({ tableName: 'equipos_gym', underscored: true, timestamps: true })
export class EquipmentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(140), allowNull: false })
  declare nombre: string;

  @Column({ type: DataType.ENUM(...Object.values(EquipmentType)), allowNull: false })
  declare tipo: EquipmentType;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare descripcion: string | null;

  @Default(EquipmentStatus.DISPONIBLE)
  @Column({ type: DataType.ENUM(...Object.values(EquipmentStatus)), allowNull: false })
  declare estado: EquipmentStatus;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
