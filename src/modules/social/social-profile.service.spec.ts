import { ConflictException } from "@nestjs/common";
import type { ConsentsService } from "../consents/consents.service";
import type { SocialProfileRepository } from "./social-profile.repository";
import { SocialProfileService } from "./social-profile.service";
import type { SocialRepository } from "./social.repository";

const userId = "00000000-0000-4000-8000-0000000000a1";

function createService(options: {
  preferencesConfigured?: boolean;
  profileEnabled?: boolean;
  photos?: number;
  saved?: unknown;
  orientationConsent?: boolean;
}) {
  const profileRepository = {
    find: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(options.saved ?? null),
    countVisiblePhotos: jest.fn().mockResolvedValue(options.photos ?? 0),
    runInTransaction: jest.fn((work: (transaction: unknown) => Promise<unknown>) => work({})),
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
  const consents = {
    assertGranted: options.orientationConsent === false
      ? jest.fn().mockRejectedValue(Object.assign(new Error("consent"), { code: "CONSENT_REQUIRED" }))
      : jest.fn().mockResolvedValue(undefined),
  };
  const service = new SocialProfileService(
    profileRepository as unknown as SocialProfileRepository,
    socialRepository as unknown as SocialRepository,
    consents as unknown as ConsentsService,
  );
  return { service, profileRepository, consents };
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
  it("refuses to store an orientation without an open ORIENTATION consent", async () => {
    const { service, profileRepository, consents } = createService({ orientationConsent: false });
    await expect(service.updateMine(userId, { ...input, orientation: "GAY" })).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(consents.assertGranted).toHaveBeenCalledWith(userId, "ORIENTATION", {});
    expect(profileRepository.save).not.toHaveBeenCalled();
  });

  it("saves a profile without orientation without asking for consent", async () => {
    const { service, profileRepository, consents } = createService({ saved: { version: 3, interests: [] } });
    await service.updateMine(userId, input);
    expect(consents.assertGranted).not.toHaveBeenCalled();
    expect(profileRepository.save).toHaveBeenCalledWith(userId, input, {});
  });

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
    expect(profileRepository.save).toHaveBeenCalledWith(userId, input, {});
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
    await expect(service.discoveryReadiness(userId, true)).resolves.toEqual({
      ready: false,
      missing: ["PROFILE_ENABLED", "PREFERENCES", "PHOTOS"],
    });
  });

  it("requires at least two visible photos", async () => {
    const one = createService({ preferencesConfigured: true, profileEnabled: true, photos: 1 });
    await expect(one.service.discoveryReadiness(userId, true)).resolves.toEqual({
      ready: false,
      missing: ["PHOTOS"],
    });
    const two = createService({ preferencesConfigured: true, profileEnabled: true, photos: 2 });
    await expect(two.service.discoveryReadiness(userId, true)).resolves.toEqual({
      ready: true,
      missing: [],
    });
  });

  it("reports only the preferences when that is all that is missing", async () => {
    const { service } = createService({ profileEnabled: true, photos: 3 });
    await expect(service.discoveryReadiness(userId, true)).resolves.toEqual({
      ready: false,
      missing: ["PREFERENCES"],
    });
  });

  it("puts the email verification first while the mailbox is unproven", async () => {
    const { service } = createService({ preferencesConfigured: true, profileEnabled: true, photos: 2 });
    await expect(service.discoveryReadiness(userId, false)).resolves.toEqual({
      ready: false,
      missing: ["EMAIL_VERIFICATION"],
    });
    const fresh = createService({});
    await expect(fresh.service.discoveryReadiness(userId, false)).resolves.toEqual({
      ready: false,
      missing: ["EMAIL_VERIFICATION", "PROFILE_ENABLED", "PREFERENCES", "PHOTOS"],
    });
  });

  it("serves the closed interests catalog as code and label pairs", () => {
    const { service } = createService({});
    const catalog = service.interestCatalog();
    expect(catalog).toContainEqual({ code: "RUNNING", label: "Correr" });
    expect(catalog.every((entry) => Object.keys(entry).sort().join() === "code,label")).toBe(true);
  });
});
