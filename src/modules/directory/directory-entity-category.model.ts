import {
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { CategoryModel } from './category.model';
import { DirectoryEntityModel } from './directory-entity.model';

@Table({
  tableName: 'entity_categories',
  schema: 'directory',
  underscored: true,
  timestamps: false,
})
export class DirectoryEntityCategoryModel extends Model {
  @PrimaryKey
  @ForeignKey(() => DirectoryEntityModel)
  @Column({ type: DataType.UUID, field: 'entity_id' })
  declare entityId: string;

  @PrimaryKey
  @ForeignKey(() => CategoryModel)
  @Column({ type: DataType.UUID, field: 'category_id' })
  declare categoryId: string;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
