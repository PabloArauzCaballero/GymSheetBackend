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

@Table({
  tableName: "body_measurements",
  schema: "profile",
  underscored: true,
  timestamps: false,
})
export class BodyMeasurementModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "user_id" })
  declare userId: string;
  @Column(DataType.DECIMAL(7, 2)) declare weight: string;
  @Column(DataType.STRING(4)) declare unit: "KG" | "LB";
  @Column({ type: DataType.DATEONLY, field: "measured_on" })
  declare measuredOn: string;
  @Column(DataType.STRING(24)) declare source:
    | "ONBOARDING"
    | "PROFILE"
    | "USER"
    | "ADMIN";
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "created_by_user_id" })
  declare createdByUserId: string;
  @Column({ type: DataType.STRING(120), field: "idempotency_key" })
  declare idempotencyKey: string | null;
  @CreatedAt @Column({ field: "created_at" }) declare createdAt: Date;
}
