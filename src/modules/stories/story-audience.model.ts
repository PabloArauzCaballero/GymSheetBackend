import { Column, DataType, ForeignKey, Model, PrimaryKey, Table } from "sequelize-typescript";
import { StoryModel } from "./story.model";
import { UserModel } from "../users/user.model";

/** Recipient snapshot for stories published to a selected audience. */
@Table({ tableName: "story_audiences", schema: "profile", underscored: true, timestamps: false })
export class StoryAudienceModel extends Model {
  @PrimaryKey
  @ForeignKey(() => StoryModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "story_id" })
  declare storyId: string;

  @PrimaryKey
  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: "user_id" })
  declare userId: string;
}
