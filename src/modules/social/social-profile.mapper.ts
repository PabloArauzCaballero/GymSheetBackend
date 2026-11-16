import type {
  DrinkingCode,
  InterestCode,
  OrientationCode,
  PetsCode,
  SmokingCode,
} from "./social-profile.catalog";

/** Persisted "Conocer" answers of one member, as the repository reads them. */
export interface SocialProfileDetailsRow {
  orientation: OrientationCode | null;
  orientationVisible: boolean;
  interests: InterestCode[];
  drinking: DrinkingCode | null;
  smoking: SmokingCode | null;
  pets: PetsCode | null;
  bio: string | null;
  version: number;
}

/** The owner's own view: every answer, including a hidden orientation. */
export type OwnSocialProfileResponse = Omit<SocialProfileDetailsRow, "version"> & {
  configured: boolean;
  version: number;
};

export function mapOwnSocialProfile(
  row: SocialProfileDetailsRow | null,
): OwnSocialProfileResponse {
  if (!row) {
    return {
      configured: false,
      orientation: null,
      orientationVisible: false,
      interests: [],
      drinking: null,
      smoking: null,
      pets: null,
      bio: null,
      version: 0,
    };
  }
  return {
    configured: true,
    orientation: row.orientation,
    orientationVisible: row.orientationVisible,
    interests: [...row.interests],
    drinking: row.drinking,
    smoking: row.smoking,
    pets: row.pets,
    bio: row.bio,
    version: row.version,
  };
}

/** Raw answers attached to a directory row; orientation is still subject to visibility. */
export type PublicAboutRow = Omit<SocialProfileDetailsRow, "version">;

/**
 * What another member may see. `orientation` is present only when its owner
 * turned visibility on; otherwise the key does not exist at all.
 */
export type PublicAboutResponse = {
  interests: InterestCode[];
  drinking: DrinkingCode | null;
  smoking: SmokingCode | null;
  pets: PetsCode | null;
  bio: string | null;
  orientation?: OrientationCode;
};

export function mapPublicAbout(
  row: PublicAboutRow | null | undefined,
): PublicAboutResponse {
  const about: PublicAboutResponse = {
    interests: [...(row?.interests ?? [])],
    drinking: row?.drinking ?? null,
    smoking: row?.smoking ?? null,
    pets: row?.pets ?? null,
    bio: row?.bio ?? null,
  };
  if (row?.orientationVisible === true && row.orientation) {
    about.orientation = row.orientation;
  }
  return about;
}
