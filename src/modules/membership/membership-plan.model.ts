import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { PlanStatus, PlanType } from "../../common/enums/domain.enums";
import { MembershipModel } from "./membership.model";
import { PlanAccessScopeModel } from "./plan-access-scope.model";
import { MediaFileModel } from "./media-file.model";

@Table({
  tableName: "plans",
  schema: "membership",
  underscored: true,
  timestamps: true,
})
export class MembershipPlanModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(80), allowNull: false, unique: true })
  declare code: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false, field: "public_id" })
  declare publicId: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Default(PlanType.CUSTOM)
  @Column({ type: DataType.STRING(30), allowNull: false, field: "plan_type" })
  declare planType: PlanType;

  @Column({ type: DataType.INTEGER, allowNull: false, field: "duration_days" })
  declare durationDays: number;

  @Default([7, 3, 1, 0])
  @Column({ type: DataType.JSONB, allowNull: false, field: "reminder_days" })
  declare reminderDays: number[];

  @Default(PlanStatus.ACTIVE)
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: PlanStatus;

  @Column({
    type: DataType.DECIMAL(12, 2),
    allowNull: true,
    field: "price_amount",
  })
  declare priceAmount: string | null;

  @Column({ type: DataType.STRING(3), allowNull: true })
  declare currency: string | null;

  @ForeignKey(() => MediaFileModel)
  @Column({ type: DataType.UUID, allowNull: true, field: "image_file_id" })
  declare imageFileId: string | null;

  @Default([])
  @Column({ type: DataType.JSONB, allowNull: false })
  declare benefits: string[];

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: "display_order" })
  declare displayOrder: number;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, field: "available_new" })
  declare availableNew: boolean;
  @Default(true)
  @Column({ type: DataType.BOOLEAN, field: "available_renewal" })
  declare availableRenewal: boolean;
  @Default(true)
  @Column({ type: DataType.BOOLEAN, field: "available_extension" })
  declare availableExtension: boolean;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @HasMany(() => PlanAccessScopeModel)
  declare accessScopes?: PlanAccessScopeModel[];

  @HasMany(() => MembershipModel)
  declare memberships?: MembershipModel[];

  @BelongsTo(() => MediaFileModel)
  declare image?: MediaFileModel | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
