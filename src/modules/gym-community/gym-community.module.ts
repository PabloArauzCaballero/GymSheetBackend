import { Module } from "@nestjs/common";
import { MeGymController } from "./me-gym.controller";
import { MyGymRepository } from "./my-gym.repository";
import { MyGymService } from "./my-gym.service";

/**
 * «Mi gimnasio» by confirmed SOCIO affiliation (ADR-0027, franja 7c).
 * Exported for the gym ranking (progression) and the gym member list (social).
 */
@Module({
  controllers: [MeGymController],
  providers: [MyGymRepository, MyGymService],
  exports: [MyGymService],
})
export class GymCommunityModule {}
