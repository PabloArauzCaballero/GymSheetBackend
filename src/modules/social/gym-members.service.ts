import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { env } from "../../config/env";
import { MyGymService } from "../gym-community/my-gym.service";
import { DirectoryEntryResponse, mapDirectoryRowToResponse } from "./social.mapper";
import { SocialRepository } from "./social.repository";

export const gymMembersQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type GymMembersQuery = z.infer<typeof gymMembersQuerySchema>;

/**
 * The members of the person's confirmed gym (ADR-0027): the same card as the
 * directory, read from the gym's confirmed SOCIOs who show their membership.
 * The gym is never a client parameter, so no other gym can be listed.
 */
@Injectable()
export class GymMembersService {
  constructor(
    private readonly myGym: MyGymService,
    private readonly repository: SocialRepository,
  ) {}

  async list(viewerId: string, tenantId: string, query: GymMembersQuery): Promise<DirectoryEntryResponse[]> {
    const gymEntityId = await this.myGym.requireConfirmedGym(viewerId);
    const rows = await this.repository.directory(viewerId, tenantId, env.DEFAULT_TENANT_ID, {
      gymEntityId,
      search: query.q,
      limit: query.limit,
    });
    return rows.map(mapDirectoryRowToResponse);
  }
}
