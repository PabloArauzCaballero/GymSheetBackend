import { Module } from "@nestjs/common";
import { LegalController } from "./legal.controller";
import { LegalRepository } from "./legal.repository";
import { LegalService } from "./legal.service";

@Module({
  controllers: [LegalController],
  providers: [LegalRepository, LegalService],
  exports: [LegalService],
})
export class LegalModule {}
