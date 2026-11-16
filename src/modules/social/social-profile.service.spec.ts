import { ConflictException } from "@nestjs/common";
import type { SocialProfileRepository } from "./social-profile.repository";
import { SocialProfileService } from "./social-profile.service";
import type { SocialRepository } from "./social.repository";

const userId = "00000000-0000-4000-8000-0000000000a1";

function createService(options: {
  preferencesConfigured?: boolean;
  profileEnabled?: boolean;
  photos?: number;
  saved?: unknown;
}) {
  const profileRepository = {
    find: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(options.saved ?? null),
    countVisiblePhotos: jest.fn().mockResolvedValue(options.photos ?? 0),
  };
  const socialRepository = {
    discoveryPreferences: jest
      .fn()
      .mockResolvedValue(
        options.preferencesConfigured
          ? { configured: true, version: 1 }
          : { configured: false, version: 0 },
      ),
    discoverySettings: jest.fn().mockResolvedValue({
      profileEnabled: options.profileEnabled ?? false,
      crossGymEnabled: false,
      mapEnabled: false,
      version: 0,
    }),
  };
  const service = new SocialProfileService(
    profileRepository as unknown as SocialProfileRepository,
    socialRepository as unknown as SocialRepository,
  );
  return { service, profileRepository };
}

const input = {
  orientation: null,
  orientationVisible: false,
  interests: [],
  drinking: null,
  smoking: null,
  pets: null,
  bio: null,
  expectedVersion: 2,
};

describe("SocialProfileService", () => {
  it("returns an unconfigured profile with version 0 before the first answer", async () => {
    const { service } = createService({});
    await expect(service.getMine(userId)).resolves.toEqual({
      configured: false,
      orientation: null,
      orientationVisible: false,
      interests: [],
      drinking: null,
      smoking: null,
      pets: null,
      bio: null,
      version: 0,
    });
  });

  it("answers 409 when the stored version moved on", async () => {
    const { service, profileRepository } = createService({ saved: null });
    await expect(service.updateMine(userId, input)).rejects.toBeInstanceOf(ConflictException);
    expect(profileRepository.save).toHaveBeenCalledWith(userId, input);
  });

  it("returns the owner's full answers, including a hidden orientation", async () => {
    const saved = { ...input, orientation: "QUEER", interests: ["YOGA"], version: 3 };
    const { service } = createService({ saved });
    await expect(service.updateMine(userId, input)).resolves.toMatchObject({
      configured: true,
      orientation: "QUEER",
      orientationVisible: false,
      interests: ["YOGA"],
      version: 3,
    });
  });

  it("lists every missing requirement for a brand-new account", async () => {
    const { service } = createService({});
    await expect(service.discoveryReadiness(userId)).resolves.toEqual({
      ready: false,
      missing: ["PROFILE_ENABLED", "PREFERENCES", "PHOTOS"],
    });
  });

  it("requires at least two visible photos", async () => {
    const one = createService({ preferencesConfigured: true, profileEnabled: true, photos: 1 });
    await expect(one.service.discoveryReadiness(userId)).resolves.toEqual({
      ready: false,
      missing: ["PHOTOS"],
    });
    const two = createService({ preferencesConfigured: true, profileEnabled: true, photos: 2 });
    await expect(two.service.discoveryReadiness(userId)).resolves.toEqual({
      ready: true,
      missing: [],
    });
  });

  it("reports only the preferences when that is all that is missing", async () => {
    const { service } = createService({ profileEnabled: true, photos: 3 });
    await expect(service.discoveryReadiness(userId)).resolves.toEqual({
      ready: false,
      missing: ["PREFERENCES"],
    });
  });

  it("serves the closed interests catalog as code and label pairs", () => {
    const { service } = createService({});
    const catalog = service.interestCatalog();
    expect(catalog).toContainEqual({ code: "RUNNING", label: "Correr" });
    expect(catalog.every((entry) => Object.keys(entry).sort().join() === "code,label")).toBe(true);
  });
});
