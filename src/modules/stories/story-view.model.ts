import { BelongsTo, Column, DataType, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { StoryModel } from "./story.model";
import { UserModel } from "../users/user.model";

/** Quién vio qué story y cuándo — clave compuesta: una vista por (story, espectador). */
@Table({ tableName: "story_views", schema: "profile", underscored: true, timestamps: false })
export class StoryViewModel extends Model {
  @PrimaryKey
  @ForeignKey(() => StoryModel)
  @Column({ type: DataType.UUID, field: "story_id" })
  declare storyId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, field: "viewer_id" })
  declare viewerId: string;

  @Column({ type: DataType.DATE, field: "viewed_at" })
  declare viewedAt: Date;

  @BelongsTo(() => StoryModel)
  declare story?: StoryModel;
}
