import { Injectable, Logger } from "@nestjs/common";
import { ProfileCompletionRepository } from "./profile-completion.repository";
import {
  ProfileCompletionView,
  ProfileItemCode,
  buildProfileCompletionView,
  pendingAwards,
  profilePointsOf,
} from "./profile-completion";

/**
 * Lleva el libro de puntos por completar el perfil.
 *
 * Se sincroniza al leer, como las insignias: abrir el perfil o la senda
 * otorga lo recién completado. Así no hace falta engancharse a cada sitio que
 * cambia un dato (fotos, bio, medidas, nivel…) y nada se pierde si una de esas
 * escrituras no avisara.
 */
@Injectable()
export class ProfileCompletionService {
  private readonly logger = new Logger(ProfileCompletionService.name);

  constructor(private readonly repository: ProfileCompletionRepository) {}

  /** Otorga lo pendiente y devuelve el estado completo. */
  async sync(userId: string, tenantId: string | null): Promise<ProfileCompletionView> {
    const [facts, before] = await Promise.all([
      this.repository.loadFacts(userId),
      this.repository.listAwards(userId),
    ]);
    const pending = pendingAwards(facts, before);
    const inserted = new Set(await this.repository.award(userId, tenantId, pending));
    const awardedNow: ProfileItemCode[] = pending.filter((item) => inserted.has(item.code)).map((item) => item.code);
    if (awardedNow.length > 0) {
      this.logger.log({ event: "progression.profile_completion.awarded", userId, items: awardedNow });
    }
    // Re-read whenever something was pending: a concurrent read may have won the
    // insert, and its rows are just as earned as ours.
    const awards = pending.length > 0 ? await this.repository.listAwards(userId) : before;
    return buildProfileCompletionView(facts, awards, awardedNow);
  }

  /**
   * Puntos del perfil **sin otorgar nada**: lo ya anotado más lo que se
   * anotará en la próxima sincronización. Es la foto previa a una sesión: si
   * contara solo el libro, lo pendiente que `sync()` paga al cerrar la sesión
   * aparecería como fruto de la sesión.
   */
  async preview(userId: string): Promise<number> {
    const [facts, awards] = await Promise.all([
      this.repository.loadFacts(userId),
      this.repository.listAwards(userId),
    ]);
    const pending = pendingAwards(facts, awards).reduce((total, item) => total + item.points, 0);
    return profilePointsOf(awards) + pending;
  }
}
