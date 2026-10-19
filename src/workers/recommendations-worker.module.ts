import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { IntegrationModule } from "../modules/integration/integration.module";
import { RecommendationsClient } from "../modules/social/recommendations-client";
import { RecommendationsProjectionRunner } from "./recommendations-projection.runner";

@Module({
  imports: [DatabaseModule, IntegrationModule],
  providers: [RecommendationsClient, RecommendationsProjectionRunner],
})
export class RecommendationsWorkerModule {}
