import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { MediaModule } from "../media/media.module";
import { StoriesController } from "./stories.controller";
import { StoriesRepository } from "./stories.repository";
import { StoriesService } from "./stories.service";
import { StoryModel } from "./story.model";
import { StoryViewModel } from "./story-view.model";

@Module({
  imports: [MediaModule, SequelizeModule.forFeature([StoryModel, StoryViewModel])],
  controllers: [StoriesController],
  providers: [StoriesRepository, StoriesService],
})
export class StoriesModule {}
