import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';
import { EquipmentStatus, EquipmentType } from '../../common/enums/domain.enums';

/** Gym equipment catalog item with English application identifiers. */
@Table({ tableName: 'equipos_gym', underscored: true, timestamps: true })
export class EquipmentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(140), allowNull: false, field: 'nombre' })
  declare name: string;

  @Column({
    type: DataType.ENUM(...Object.values(EquipmentType)),
    allowNull: false,
    field: 'tipo',
  })
  declare type: EquipmentType;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'descripcion' })
  declare description: string | null;

  @Default(EquipmentStatus.AVAILABLE)
  @Column({
    type: DataType.ENUM(...Object.values(EquipmentStatus)),
    allowNull: false,
    field: 'estado',
  })
  declare status: EquipmentStatus;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
