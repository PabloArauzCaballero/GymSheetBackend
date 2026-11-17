import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserRole } from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";

export type PlatformModeratorResponse = { id: string; email: string; nombreCompleto: string; estado: string };

/**
 * The central REPP moderation team (ADR-0018), managed by SYSTEM_ADMIN only.
 *
 * A moderator is an existing member account (`CLIENTE`) turned into
 * `MODERATOR`; revoking turns it back into `CLIENTE`. Gym staff and platform
 * administrators are refused: staff accounts belong to a gym's operations and
 * one account must not wear both hats. The role is read from the database on
 * every request, so both changes apply on the next call of the account.
 */
@Injectable()
export class PlatformModeratorsService {
  constructor(private readonly sequelize: Sequelize) {}

  list(): Promise<PlatformModeratorResponse[]> {
    return this.sequelize.query<PlatformModeratorResponse>(
      `SELECT id, email, nombre_completo AS "nombreCompleto", estado
         FROM public.usuarios
        WHERE rol = :role
        ORDER BY nombre_completo, id`,
      { type: QueryTypes.SELECT, replacements: { role: UserRole.MODERATOR } },
    );
  }

  /** Idempotent: an account that already moderates stays as it is. */
  async assign(userId: string): Promise<PlatformModeratorResponse> {
    return this.sequelize.transaction(async (transaction) => {
      const [account] = await this.sequelize.query<{ role: UserRole }>(
        `SELECT rol AS role FROM public.usuarios
          WHERE id = :userId AND estado = 'ACTIVO' AND closed_at IS NULL
          FOR UPDATE`,
        { type: QueryTypes.SELECT, replacements: { userId }, transaction },
      );
      if (!account) throw new NotFoundException("Usuario no encontrado.");
      if (account.role !== UserRole.CLIENT && account.role !== UserRole.MODERATOR) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          "MODERATOR_NOT_ASSIGNABLE",
          "Solo una cuenta de socio puede pasar al equipo de moderación de REPP.",
          { role: account.role },
        );
      }
      const [moderator] = await this.sequelize.query<PlatformModeratorResponse>(
        `UPDATE public.usuarios SET rol = :role, updated_at = now() WHERE id = :userId
         RETURNING id, email, nombre_completo AS "nombreCompleto", estado`,
        { type: QueryTypes.SELECT, replacements: { userId, role: UserRole.MODERATOR }, transaction },
      );
      return moderator;
    });
  }

  /**
   * Back to a member account. The cases it had claimed go back to the queue:
   * nobody else could claim or resolve them while the claim stood.
   */
  async revoke(userId: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const [, affected] = await this.sequelize.query(
        `UPDATE public.usuarios SET rol = :member, updated_at = now() WHERE id = :userId AND rol = :role`,
        {
          type: QueryTypes.UPDATE,
          replacements: { userId, member: UserRole.CLIENT, role: UserRole.MODERATOR },
          transaction,
        },
      );
      if (Number(affected) === 0) throw new NotFoundException("Esa cuenta no es del equipo de moderación.");
      await this.sequelize.query(
        `UPDATE moderation.reports
            SET status = 'PENDIENTE', claimed_by_user_id = NULL, claimed_at = NULL
          WHERE claimed_by_user_id = :userId AND status = 'EN_REVISION'`,
        { type: QueryTypes.UPDATE, replacements: { userId }, transaction },
      );
    });
  }
}
