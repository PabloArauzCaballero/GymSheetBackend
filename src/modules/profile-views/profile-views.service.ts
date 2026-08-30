import { Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { UsersRepository } from "../users/users.repository";
import { ProfileViewsRepository } from "./profile-views.repository";

@Injectable()
export class ProfileViewsService {
  constructor(
    private readonly repository: ProfileViewsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  /**
   * Se ignoran en silencio, sin error: verse a uno mismo o a alguien de otro
   * tenant no es un mal pedido del cliente, solo no hay nada que registrar.
   */
  async record(viewerId: string, viewerTenantId: string, viewedUserId: string): Promise<void> {
    if (viewerId === viewedUserId) return;
    const viewedUser = await this.usersRepository.findActiveById(viewedUserId);
    if (!viewedUser) return;
    const viewedTenantId = viewedUser.tenantId ?? env.DEFAULT_TENANT_ID;
    if (viewedTenantId !== viewerTenantId) return;
    await this.repository.record(viewerId, viewedUserId, viewerTenantId);
  }

  async summary(userId: string): Promise<{ uniqueViewersToday: number }> {
    const uniqueViewersToday = await this.repository.countUniqueTodayFor(userId);
    return { uniqueViewersToday };
  }
}
