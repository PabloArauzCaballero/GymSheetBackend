import { applySocialDiscoverySettings, defaultSocialDiscoverySettings } from "./social-discovery-settings.policy";

describe("social discovery consent", () => {
  it("starts private with every discovery surface disabled", () => {
    expect(defaultSocialDiscoverySettings()).toEqual({
      profileEnabled: false,
      crossGymEnabled: false,
      mapEnabled: false,
      version: 0,
    });
  });

  it("keeps cross-gym and map consent independent and increments the version", () => {
    expect(applySocialDiscoverySettings(defaultSocialDiscoverySettings(), {
      profileEnabled: true,
      crossGymEnabled: true,
      mapEnabled: false,
      version: 0,
    }, 0)).toEqual({ profileEnabled: true, crossGymEnabled: true, mapEnabled: false, version: 1 });
  });

  it("rejects enabling a discovery surface while the social profile is paused", () => {
    expect(() => applySocialDiscoverySettings(defaultSocialDiscoverySettings(), {
      profileEnabled: false,
      crossGymEnabled: false,
      mapEnabled: true,
      version: 0,
    }, 0)).toThrow("SOCIAL_DISCOVERY_REQUIRES_PROFILE");
  });

  it("rejects a stale settings write", () => {
    expect(() => applySocialDiscoverySettings({ ...defaultSocialDiscoverySettings(), version: 3 }, {
      profileEnabled: true,
      crossGymEnabled: false,
      mapEnabled: false,
      version: 3,
    }, 2)).toThrow("SOCIAL_SETTINGS_VERSION_CONFLICT");
  });
});
