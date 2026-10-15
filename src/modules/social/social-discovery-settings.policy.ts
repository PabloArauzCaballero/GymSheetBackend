export type SocialDiscoverySettings = {
  profileEnabled: boolean;
  crossGymEnabled: boolean;
  mapEnabled: boolean;
  version: number;
};

export type SocialDiscoverySettingsCommand = SocialDiscoverySettings;

export function defaultSocialDiscoverySettings(): SocialDiscoverySettings {
  return { profileEnabled: false, crossGymEnabled: false, mapEnabled: false, version: 0 };
}

export function applySocialDiscoverySettings(
  current: SocialDiscoverySettings,
  command: SocialDiscoverySettingsCommand,
  expectedVersion: number,
): SocialDiscoverySettings {
  if (expectedVersion !== current.version) throw new Error("SOCIAL_SETTINGS_VERSION_CONFLICT");
  if ((!command.profileEnabled && (command.crossGymEnabled || command.mapEnabled))) {
    throw new Error("SOCIAL_DISCOVERY_REQUIRES_PROFILE");
  }
  return { ...command, version: current.version + 1 };
}
