import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { StoriesModule } from "../modules/stories/stories.module";
import { StoriesPurgeRunner } from "./stories-purge.runner";

@Module({
  imports: [DatabaseModule, StoriesModule],
  providers: [StoriesPurgeRunner],
})
export class StoriesWorkerModule {}
