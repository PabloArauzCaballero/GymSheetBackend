import { HttpStatus, Injectable } from "@nestjs/common";
import { DomainException } from "../../common/errors/domain.exception";
import { MyGymResponse, mapLeaderboard, mapMyGym } from "./my-gym.mapper";
import { MyGymRepository } from "./my-gym.repository";

/**
 * «Mi gimnasio» (ADR-0027): the gym of a person is their CONFIRMED SOCIO
 * affiliation. Gym-scoped surfaces call `requireConfirmedGym` and never take
 * a gym id from the client, so another gym's community cannot be addressed.
 */
@Injectable()
export class MyGymService {
  constructor(private readonly repository: MyGymRepository) {}

  async state(userId: string): Promise<MyGymResponse> {
    const [rows, visible] = await Promise.all([this.repository.liveSocio(userId), this.repository.membershipVisible(userId)]);
    return mapMyGym(rows, visible);
  }

  async setMembershipVisible(userId: string, visible: boolean): Promise<MyGymResponse> {
    await this.repository.setMembershipVisible(userId, visible);
    return this.state(userId);
  }

  /** The gym entity of the person's confirmed membership, or 403 `GYM_MEMBERSHIP_REQUIRED` with the current status. */
  async requireConfirmedGym(userId: string): Promise<string> {
    const gymEntityId = await this.repository.confirmedGymOf(userId);
    if (gymEntityId) return gymEntityId;
    const { status } = await this.state(userId);
    throw new DomainException(
      HttpStatus.FORBIDDEN,
      "GYM_MEMBERSHIP_REQUIRED",
      status === "REQUESTED"
        ? "Tu solicitud al gimnasio está enviada: verás su comunidad cuando la confirme."
        : "Únete a un gimnasio para ver su comunidad.",
      { status },
    );
  }

  async leaderboard(userId: string, limit: number, sortBy: "points" | "streak") {
    const gymEntityId = await this.requireConfirmedGym(userId);
    return mapLeaderboard(await this.repository.leaderboard(gymEntityId, userId, limit, sortBy), userId);
  }
}
