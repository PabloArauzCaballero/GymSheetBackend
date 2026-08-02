import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { FitnessGoal, OnboardingStatus } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";

@Table({
  tableName: "onboarding",
  schema: "profile",
  underscored: true,
  timestamps: true,
})
export class OnboardingModel extends Model {
  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;
  @Column(DataType.STRING(24)) declare status: OnboardingStatus;
  @Column({ type: DataType.INTEGER, field: "current_step" })
  declare currentStep: number;
  @Column({ type: DataType.JSONB, field: "completed_steps" })
  declare completedSteps: number[];
  @Column(DataType.INTEGER) declare version: number;
  @Column({ type: DataType.STRING(40), field: "primary_goal" })
  declare primaryGoal: FitnessGoal | null;
  @Column({ type: DataType.STRING(24), field: "experience_level" })
  declare experienceLevel: string | null;
  @Column({ type: DataType.INTEGER, field: "weekly_frequency" })
  declare weeklyFrequency: number | null;
  @Column({ type: DataType.STRING(24), field: "training_location" })
  declare trainingLocation: string | null;
  @Column({ type: DataType.JSONB, field: "available_equipment" })
  declare availableEquipment: string[];
  @Column({ type: DataType.JSONB, field: "training_preferences" })
  declare trainingPreferences: string[];
  @Column({ type: DataType.TEXT, field: "physical_considerations" })
  declare physicalConsiderations: string | null;
  @Column({ type: DataType.STRING(4), field: "weight_unit" })
  declare weightUnit: "KG" | "LB";
  @Column({ type: DataType.STRING(4), field: "height_unit" })
  declare heightUnit: "CM" | "IN";
  @Column({ type: DataType.DECIMAL(7, 2), field: "height_value" })
  declare heightValue: string | null;
  @Column({ type: DataType.BOOLEAN, field: "consent_health" })
  declare consentHealth: boolean;
  @Column({ type: DataType.BOOLEAN, field: "consent_data" })
  declare consentData: boolean;
  @Column({ type: DataType.DATE, field: "started_at" })
  declare startedAt: Date | null;
  @Column({ type: DataType.DATE, field: "completed_at" })
  declare completedAt: Date | null;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
  @UpdatedAt @Column({ field: "updated_at" }) declare updatedAt: Date;
}
