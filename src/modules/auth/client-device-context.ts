import { Request } from "express";
import { env } from "../../config/env";
import { LegalChannel, legalClientContext } from "../legal/legal-client-context";

/** What the client says about the installation it runs on. Every field is optional. */
export type ClientDeviceContext = {
  /** Random UUID generated once per install (never a hardware id). */
  installationId: string | null;
  platform: LegalChannel;
  appVersion: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  userAgent: string | null;
  /** HMAC-SHA256 of the client IP; null when `IP_HASH_SECRET` is unset. */
  ipHmac: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
// Letters, digits and the punctuation real version/model strings use. Anything
// else (control characters, markup) makes the header count as absent.
const LABEL = /^[\p{L}\p{N} ._+\-(),/]+$/u;

function boundedLabel(raw: string | undefined, maxLength: number): string | null {
  const value = raw?.trim();
  if (!value || value.length > maxLength || !LABEL.test(value)) return null;
  return value;
}

/**
 * Reads the device headers (`X-Installation-Id`, `X-Client-Platform`,
 * `X-App-Version`, `X-OS-Version`, `X-Device-Model`). Invalid values are
 * ignored rather than rejected: the headers are telemetry, and a malformed one
 * must never stop a person from logging in.
 */
export function clientDeviceContext(
  request: Request,
  ipHashSecret: string | undefined = env.IP_HASH_SECRET,
): ClientDeviceContext {
  const legal = legalClientContext(request, ipHashSecret);
  const installationId = request.header("x-installation-id")?.trim() ?? "";
  return {
    installationId: UUID.test(installationId) ? installationId.toLowerCase() : null,
    platform: legal.channel,
    appVersion: boundedLabel(request.header("x-app-version"), 40),
    osVersion: boundedLabel(request.header("x-os-version"), 40),
    deviceModel: boundedLabel(request.header("x-device-model"), 80),
    userAgent: legal.userAgent,
    ipHmac: legal.ipHmac,
  };
}
