import { Column, CreatedAt, DataType, Default, HasMany, Model, PrimaryKey, Table } from "sequelize-typescript";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { MessageModel } from "./message.model";

export type ConversationKind = "DIRECT" | "SYSTEM" | "BUSINESS";

@Table({ tableName: "conversations", schema: "chat", underscored: true, timestamps: false })
export class ConversationModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  /**
   * `null` for a regular chat between members. `CORPORATE` pins the
   * conversation at the top of the list and marks the other side as the only
   * one that can write (see `ConversationParticipantModel.canWrite`).
   * `TENANT_ADMIN` rows are legacy, revoked by migration 202611200301 and
   * never listed (ADR-0019); the value goes away in franja 7d.
   */
  @Column({ type: DataType.STRING(20), allowNull: true, field: "system_kind" })
  declare systemKind: "CORPORATE" | "TENANT_ADMIN" | null;

  /** BUSINESS: a person with a business (ADR-0023); no disappearing messages and no location there. */
  @Default("DIRECT")
  @Column({ type: DataType.STRING(10), allowNull: false })
  declare kind: ConversationKind;

  /** The listing of a BUSINESS conversation; its participant is the business account. */
  @Column({ type: DataType.UUID, allowNull: true, field: "business_entity_id" })
  declare businessEntityId: string | null;

  /** The person of a BUSINESS conversation, the only side that can open it. */
  @Column({ type: DataType.UUID, allowNull: true, field: "person_user_id" })
  declare personUserId: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: "revoked_at" })
  declare revokedAt: Date | null;

  @Column({ type: DataType.UUID, allowNull: true, field: "revoked_by_user_id" })
  declare revokedByUserId: string | null;

  /** Mensajes temporales: segundos de vida de lo que se envíe (24 h, 7 días o 90 días); `null` = desactivado. */
  @Column({ type: DataType.INTEGER, allowNull: true, field: "disappearing_seconds" })
  declare disappearingSeconds: number | null;

  @HasMany(() => ConversationParticipantModel)
  declare participants?: ConversationParticipantModel[];

  @HasMany(() => MessageModel)
  declare messages?: MessageModel[];

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;
}
