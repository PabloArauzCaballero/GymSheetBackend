import { createHmac } from "crypto";
import { Request } from "express";
import { env } from "../../config/env";

export const LEGAL_CHANNELS = ["WEB", "IOS", "ANDROID", "UNKNOWN"] as const;
export type LegalChannel = (typeof LEGAL_CHANNELS)[number];

/** Request metadata stored with each acceptance as audit evidence. */
export type LegalClientContext = {
  channel: LegalChannel;
  /** HMAC-SHA256 of the client IP; null when `IP_HASH_SECRET` is not configured. */
  ipHmac: string | null;
  userAgent: string | null;
};

const USER_AGENT_MAX_LENGTH = 400;

function channelFrom(header: string | undefined): LegalChannel {
  const normalized = header?.trim().toUpperCase();
  return LEGAL_CHANNELS.find((channel) => channel === normalized) ?? "UNKNOWN";
}

/**
 * Builds the audit context from the request. The raw IP is never stored: a
 * keyed hash still lets an investigation confirm "same address" without the
 * table becoming a log of personal data.
 */
export function legalClientContext(
  request: Request,
  ipHashSecret: string | undefined = env.IP_HASH_SECRET,
): LegalClientContext {
  const ip = request.ip;
  const userAgent = request.header("user-agent")?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;
  return {
    channel: channelFrom(request.header("x-client-platform")),
    ipHmac: ipHashSecret && ip ? createHmac("sha256", ipHashSecret).update(ip).digest("hex") : null,
    userAgent: userAgent || null,
  };
}
