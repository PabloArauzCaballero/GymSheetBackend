import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { MediaModule } from "../media/media.module";
import { ChatModule } from "../chat/chat.module";
import { StoriesController } from "./stories.controller";
import { StoriesPurgeService } from "./stories-purge.service";
import { StoriesRepository } from "./stories.repository";
import { StoriesService } from "./stories.service";
import { StoryModel } from "./story.model";
import { StoryViewModel } from "./story-view.model";
import { StoryAudienceModel } from "./story-audience.model";
import { StoryReactionsService } from "./story-reactions.service";

@Module({
  imports: [MediaModule, ChatModule, SequelizeModule.forFeature([StoryModel, StoryViewModel, StoryAudienceModel])],
  controllers: [StoriesController],
  providers: [StoriesRepository, StoriesService, StoriesPurgeService, StoryReactionsService],
  // El worker de purga (`workers/stories-purge.worker.ts`) consume este servicio.
  exports: [StoriesPurgeService],
})
export class StoriesModule {}
