import { Column, DataType, Model, PrimaryKey, Table } from "sequelize-typescript";

@Table({ tableName: "gym_places", schema: "social", underscored: true, timestamps: false })
export class SocialMapPlaceModel extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({ type: DataType.STRING(8), allowNull: false })
  declare kind: "GYM" | "CITY";

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare source: "OPENSTREETMAP";

  @Column({ type: DataType.STRING(64), allowNull: false, field: "source_id" })
  declare sourceId: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(240), allowNull: true })
  declare address: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare city: string | null;

  @Column({ type: DataType.STRING(120), allowNull: true })
  declare region: string | null;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: false })
  declare latitude: string;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: false })
  declare longitude: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare tags: Record<string, string>;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare license: string;

  @Column({ type: DataType.STRING(160), allowNull: false })
  declare attribution: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare active: boolean;

  @Column({ type: DataType.DATE, allowNull: false, field: "imported_at" })
  declare importedAt: Date;
}
