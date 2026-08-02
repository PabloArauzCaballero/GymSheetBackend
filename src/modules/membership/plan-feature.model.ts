import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from "sequelize-typescript";
import { MembershipFeatureModel } from "./membership-feature.model";
import { MembershipPlanModel } from "./membership-plan.model";

@Table({
  tableName: "plan_features",
  schema: "membership",
  underscored: true,
  timestamps: false,
})
export class PlanFeatureModel extends Model {
  @PrimaryKey
  @ForeignKey(() => MembershipPlanModel)
  @Column({ type: DataType.UUID, field: "plan_id" })
  declare planId: string;
  @PrimaryKey
  @ForeignKey(() => MembershipFeatureModel)
  @Column({ type: DataType.UUID, field: "feature_id" })
  declare featureId: string;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
}
