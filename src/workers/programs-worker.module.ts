import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ProgramsModule } from "../modules/programs/programs.module";
import { ProgramWeekCloseRunner } from "./program-week-close.runner";

@Module({
  imports: [DatabaseModule, ProgramsModule],
  providers: [ProgramWeekCloseRunner],
})
export class ProgramsWorkerModule {}
