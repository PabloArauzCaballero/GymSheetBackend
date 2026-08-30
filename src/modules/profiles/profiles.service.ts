import { Injectable, NotFoundException } from "@nestjs/common";
import { OnboardingRepository } from "./onboarding.repository";
import {
  AnthropometricProfileResponse,
  mapProfileToResponse,
} from "./profile.mapper";
import { ProfilesRepository } from "./profiles.repository";
import { UpsertProfileInput } from "./profiles.schemas";

@Injectable()
export class ProfilesService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly onboardingRepository: OnboardingRepository,
  ) {}

  async getMyProfile(userId: string): Promise<AnthropometricProfileResponse> {
    const profile = await this.profilesRepository.findByUserId(userId);

    if (!profile) {
      throw new NotFoundException(
        "El perfil antropométrico todavía no fue registrado.",
      );
    }

    return mapProfileToResponse(profile);
  }

  async upsertMyProfile(
    userId: string,
    input: UpsertProfileInput,
  ): Promise<AnthropometricProfileResponse> {
    const profile = await this.profilesRepository.upsertByUserId(userId, input);
    // Toda edición de peso pasa también por el histórico: es el mismo dato
    // que ya alimenta `GET /me/body-measurements`, y antes de esto solo el
    // onboarding lo registraba ahí. La clave de idempotencia evita una fila
    // nueva si la misma edición (mismo día, mismo peso) llega dos veces.
    const measuredOn = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `profile:${measuredOn}:${input.weightKg}`;
    if (!(await this.onboardingRepository.findMeasurementByKey(userId, idempotencyKey))) {
      await this.onboardingRepository.createMeasurement({
        userId,
        weight: input.weightKg,
        unit: "KG",
        measuredOn,
        source: "PROFILE",
        createdByUserId: userId,
        idempotencyKey,
      });
    }
    return mapProfileToResponse(profile);
  }
}
