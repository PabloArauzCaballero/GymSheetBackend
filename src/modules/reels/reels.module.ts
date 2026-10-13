import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { MediaModule } from "../media/media.module";
import { ReelModel } from "./reel.model";
import { ReelsController } from "./reels.controller";
import { ReelsRepository } from "./reels.repository";
import { ReelsService } from "./reels.service";

@Module({
  imports: [MediaModule, SequelizeModule.forFeature([ReelModel])],
  controllers: [ReelsController],
  providers: [ReelsRepository, ReelsService],
})
export class ReelsModule {}
