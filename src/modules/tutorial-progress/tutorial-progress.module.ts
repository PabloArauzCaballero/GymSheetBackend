import { Module } from "@nestjs/common";
import { SequelizeModule } from "@nestjs/sequelize";
import { TutorialProgressController } from "./tutorial-progress.controller";
import { TutorialProgressModel } from "./tutorial-progress.model";
import { TutorialProgressRepository } from "./tutorial-progress.repository";
import { TutorialProgressService } from "./tutorial-progress.service";

@Module({
  imports: [SequelizeModule.forFeature([TutorialProgressModel])],
  controllers: [TutorialProgressController],
  providers: [TutorialProgressRepository, TutorialProgressService],
})
export class TutorialProgressModule {}
