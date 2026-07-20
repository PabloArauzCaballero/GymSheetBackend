import { Column, CreatedAt, DataType, Default, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { FacilityStatus } from '../../common/enums/domain.enums';
import { AccessPointModel } from './access-point.model';
import { RoomModel } from './room.model';

@Table({ tableName: 'branches', schema: 'facilities', underscored: true, timestamps: true })
export class BranchModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(60), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.STRING(80), allowNull: false, field: 'time_zone' })
  declare timeZone: string;

  @Default(FacilityStatus.ACTIVE)
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: FacilityStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @HasMany(() => RoomModel)
  declare rooms?: RoomModel[];

  @HasMany(() => AccessPointModel)
  declare accessPoints?: AccessPointModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
