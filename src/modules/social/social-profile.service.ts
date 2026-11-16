import { ConflictException, Injectable } from "@nestjs/common";
import { INTEREST_CATALOG, type InterestCatalogEntry } from "./social-profile.catalog";
import {
  mapOwnSocialProfile,
  type OwnSocialProfileResponse,
} from "./social-profile.mapper";
import { SocialProfileRepository } from "./social-profile.repository";
import type { UpdateSocialProfileInput } from "./social-profile.schemas";
import { SocialRepository } from "./social.repository";

export const MIN_DISCOVERY_PHOTOS = 2;

/**
 * Items that keep a member out of discovery. Clients must ignore codes they do
 * not know yet, so new requirements (e.g. EMAIL_VERIFICATION) can be added.
 */
export type DiscoveryReadinessItem =
  | "EMAIL_VERIFICATION"
  | "PREFERENCES"
  | "PHOTOS"
  | "PROFILE_ENABLED";

export type DiscoveryReadinessResponse = {
  ready: boolean;
  missing: DiscoveryReadinessItem[];
};

type ReadinessFacts = {
  emailVerified: boolean;
  preferencesConfigured: boolean;
  visiblePhotos: number;
  profileEnabled: boolean;
};

// Ordered checks: the first missing item is the next step the client shows.
const READINESS_CHECKS: ReadonlyArray<{
  item: DiscoveryReadinessItem;
  satisfied: (facts: ReadinessFacts) => boolean;
}> = [
  { item: "EMAIL_VERIFICATION", satisfied: (facts) => facts.emailVerified },
  { item: "PROFILE_ENABLED", satisfied: (facts) => facts.profileEnabled },
  { item: "PREFERENCES", satisfied: (facts) => facts.preferencesConfigured },
  { item: "PHOTOS", satisfied: (facts) => facts.visiblePhotos >= MIN_DISCOVERY_PHOTOS },
];

@Injectable()
export class SocialProfileService {
  constructor(
    private readonly repository: SocialProfileRepository,
    private readonly socialRepository: SocialRepository,
  ) {}

  interestCatalog(): readonly InterestCatalogEntry[] {
    return INTEREST_CATALOG;
  }

  async getMine(userId: string): Promise<OwnSocialProfileResponse> {
    return mapOwnSocialProfile(await this.repository.find(userId));
  }

  async updateMine(
    userId: string,
    input: UpdateSocialProfileInput,
  ): Promise<OwnSocialProfileResponse> {
    const saved = await this.repository.save(userId, input);
    if (!saved) {
      throw new ConflictException(
        "Tu perfil cambió en otro dispositivo. Recarga e intenta otra vez.",
      );
    }
    return mapOwnSocialProfile(saved);
  }

  async discoveryReadiness(
    userId: string,
    emailVerified: boolean,
  ): Promise<DiscoveryReadinessResponse> {
    const [preferences, settings, visiblePhotos] = await Promise.all([
      this.socialRepository.discoveryPreferences(userId),
      this.socialRepository.discoverySettings(userId),
      this.repository.countVisiblePhotos(userId),
    ]);
    const facts: ReadinessFacts = {
      emailVerified,
      preferencesConfigured: preferences.configured,
      visiblePhotos,
      profileEnabled: settings.profileEnabled,
    };
    const missing = READINESS_CHECKS.filter((check) => !check.satisfied(facts)).map(
      (check) => check.item,
    );
    return { ready: missing.length === 0, missing };
  }
}
