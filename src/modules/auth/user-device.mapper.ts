import { UserDeviceRow } from "./user-device.repository";

export type UserDeviceResponse = {
  id: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  deviceModel: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** True for the installation that made this request (`X-Installation-Id`). */
  current: boolean;
};

/** The installation id and IP hash stay server-side: they identify, they do not inform. */
export function mapUserDevice(row: UserDeviceRow, currentInstallationId: string | null): UserDeviceResponse {
  return {
    id: row.id,
    platform: row.platform,
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    deviceModel: row.deviceModel,
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    current: currentInstallationId !== null && row.installationId === currentInstallationId,
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  WEB: "navegador web",
  IOS: "iOS",
  ANDROID: "Android",
};

/** Human description for the new-device email, e.g. "Pixel 8 (Android 15)". */
export function describeDevice(device: {
  platform: string;
  deviceModel: string | null;
  osVersion: string | null;
}): string {
  const platform = PLATFORM_LABELS[device.platform] ?? "dispositivo desconocido";
  const system = device.osVersion ? `${platform} ${device.osVersion}` : platform;
  return device.deviceModel ? `${device.deviceModel} (${system})` : system;
}
