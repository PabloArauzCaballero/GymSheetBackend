import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { MediaModule } from "../media/media.module";
import { StoriesController } from "./stories.controller";
import { StoriesPurgeService } from "./stories-purge.service";
import { StoriesRepository } from "./stories.repository";
import { StoriesService } from "./stories.service";
import { StoryModel } from "./story.model";
import { StoryViewModel } from "./story-view.model";

@Module({
  imports: [MediaModule, SequelizeModule.forFeature([StoryModel, StoryViewModel])],
  controllers: [StoriesController],
  providers: [StoriesRepository, StoriesService, StoriesPurgeService],
  // El worker de purga (`workers/stories-purge.worker.ts`) consume este servicio.
  exports: [StoriesPurgeService],
})
export class StoriesModule {}
