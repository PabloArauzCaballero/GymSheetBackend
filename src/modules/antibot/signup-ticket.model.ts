import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

export type SignupTicketKind = "FORM" | "ATTESTATION";

/**
 * Ledger of SPENT single-use tokens (form tickets and attestation nonces).
 * Issuing writes nothing: a token is stateless until it is used, so flooding
 * the issuing endpoints cannot grow this table. A row here means "already used".
 */
@Table({ tableName: "signup_tickets", schema: "auth", underscored: true, timestamps: false })
export class SignupTicketModel extends Model {
  @PrimaryKey
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  declare kind: SignupTicketKind;

  @Column({ type: DataType.DATE, allowNull: false, field: "issued_at" })
  declare issuedAt: Date;

  @Column({ type: DataType.DATE, allowNull: false, field: "used_at" })
  declare usedAt: Date;
}
