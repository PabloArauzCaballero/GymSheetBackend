import {
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { UserModel } from "../users/user.model";

/** Solicitud de conexión entre dos socios. `requesterId` es quien la envió. */
@Table({
  tableName: "connections",
  schema: "social",
  underscored: true,
  timestamps: true,
})
export class ConnectionModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "requester_id" })
  declare requesterId: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "addressee_id" })
  declare addresseeId: string;

  // La columna es varchar(12) con un CHECK, no un ENUM nativo de Postgres —
  // igual que `EntitlementModel.status` — así que se tipa como STRING y no
  // como DataType.ENUM, que asumiría un tipo de columna que no existe.
  @Default(ConnectionStatus.PENDING)
  @Column({ type: DataType.STRING(12), allowNull: false })
  declare status: ConnectionStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: "responded_at" })
  declare respondedAt: Date | null;

  @CreatedAt
  @Column({ field: "created_at" })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: "updated_at" })
  declare updatedAt: Date;
}
