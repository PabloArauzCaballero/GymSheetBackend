import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { UserModel } from '../users/user.model';

@Table({ tableName: 'customer_profiles', schema: 'membership', underscored: true, timestamps: true })
export class CustomerProfileModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, unique: true, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(80), allowNull: false, unique: true, field: 'customer_number' })
  declare customerNumber: string;

  @Column({ type: DataType.STRING(40), allowNull: true, field: 'phone_number' })
  declare phoneNumber: string | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATEONLY, allowNull: false, field: 'joined_on' })
  declare joinedOn: string;

  @Column({ type: DataType.STRING(180), allowNull: true, field: 'external_reference' })
  declare externalReference: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => UserModel)
  declare user?: UserModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
