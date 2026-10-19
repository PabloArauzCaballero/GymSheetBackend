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
} from 'sequelize-typescript';

@Table({
  tableName: 'categories',
  schema: 'directory',
  underscored: true,
  timestamps: true,
})
export class CategoryModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => CategoryModel)
  @Column({ type: DataType.UUID, allowNull: true, field: 'parent_id' })
  declare parentId: string | null;

  @BelongsTo(() => CategoryModel, { as: 'parent', foreignKey: 'parentId' })
  declare parent?: CategoryModel | null;

  @HasMany(() => CategoryModel, { as: 'children', foreignKey: 'parentId' })
  declare children?: CategoryModel[];

  @Column({ type: DataType.STRING(80), allowNull: false, unique: true })
  declare slug: string;

  /** Materialized path indexable, e.g. 'tiendas.nutricion.proteinas' */
  @Column({ type: DataType.TEXT, allowNull: false })
  declare path: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true, field: 'icon_key' })
  declare iconKey: string | null;

  @Default('ALL')
  @Column({ type: DataType.STRING(30), allowNull: false, field: 'entity_scope' })
  declare entityScope: string;

  @Default(0)
  @Column({ type: DataType.INTEGER, allowNull: false, field: 'display_order' })
  declare displayOrder: number;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_active' })
  declare isActive: boolean;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
