import {
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import { MembershipIntentModel } from "./membership-intent.model";
import { MembershipModel } from "./membership.model";

@Table({
  tableName: "extensions",
  schema: "membership",
  underscored: true,
  timestamps: false,
})
export class MembershipExtensionModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @ForeignKey(() => MembershipModel)
  @Column({ type: DataType.UUID, field: "membership_id" })
  declare membershipId: string;
  @ForeignKey(() => MembershipIntentModel)
  @Column({ type: DataType.UUID, field: "intent_id" })
  declare intentId: string;
  @Column({ type: DataType.DATEONLY, field: "previous_ends_on" })
  declare previousEndsOn: string;
  @Column({ type: DataType.DATEONLY, field: "new_ends_on" })
  declare newEndsOn: string;
  @Column({ type: DataType.INTEGER, field: "added_days" })
  declare addedDays: number;
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "created_by_user_id" })
  declare createdByUserId: string;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
}
