import { Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { UserModel } from "../users/user.model";
import type {
  VerificationGestureCode,
  VerificationRejectionReason,
  VerificationStatusValue,
} from "./verification.catalog";

/** One person-verification attempt (gesture selfie reviewed by moderation). */
@Table({ tableName: "photo_verifications", schema: "social", underscored: true, timestamps: false })
export class PhotoVerificationModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;

  @Column({ type: DataType.STRING(20), allowNull: false, field: "gesture_code" })
  declare gestureCode: VerificationGestureCode;

  @Column({ type: DataType.DATE, allowNull: false, field: "challenge_issued_at" })
  declare challengeIssuedAt: Date;

  @Column({ type: DataType.DATE, allowNull: false, field: "challenge_expires_at" })
  declare challengeExpiresAt: Date;

  /** Private storage key (encrypted object). Never exposed as a URL. */
  @Column({ type: DataType.TEXT, allowNull: true, field: "selfie_storage_key" })
  declare selfieStorageKey: string | null;

  @Column({ type: DataType.STRING(20), allowNull: true, field: "selfie_mime_type" })
  declare selfieMimeType: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "selfie_deleted_at" })
  declare selfieDeletedAt: Date | null;

  @Column({ type: DataType.STRING(16), allowNull: false })
  declare status: VerificationStatusValue;

  @Column({ type: DataType.UUID, allowNull: true, field: "reviewer_id" })
  declare reviewerId: string | null;

  @Column({ type: DataType.STRING(30), allowNull: true, field: "decision_reason" })
  declare decisionReason: VerificationRejectionReason | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "decided_at" })
  declare decidedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "submitted_at" })
  declare submittedAt: Date | null;

  /** Profile photos the moderator compared against at approval time. */
  @Column({ type: DataType.ARRAY(DataType.UUID), allowNull: true, field: "approved_photo_ids" })
  declare approvedPhotoIds: string[] | null;

  /** Set when all approved photos were removed and `verified_at` was cleared. */
  @Column({ type: DataType.DATE, allowNull: true, field: "revoked_at" })
  declare revokedAt: Date | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
