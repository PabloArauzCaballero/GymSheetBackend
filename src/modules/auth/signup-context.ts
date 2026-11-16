import { Request } from "express";
import type { SignupContext } from "../antibot/signup-protection.types";
import { LegalClientContext, legalClientContext } from "../legal/legal-client-context";
import { RegisterInput } from "./auth.schemas";
import { ClientDeviceContext, clientDeviceContext } from "./client-device-context";

/** Request metadata the signup needs: legal evidence, device and the raw IP for antibot. */
export type SignupRequestMeta = {
  legal: LegalClientContext;
  device: ClientDeviceContext;
  /** Raw IP, handed to antibot for velocity checks; never persisted by auth. */
  ip: string | null;
  /**
   * Set only by server-side code that creates accounts on purpose (seeds).
   * `signupRequestMeta` never sets it, so no request can reach it.
   */
  internal?: true;
};

export function signupRequestMeta(request: Request): SignupRequestMeta {
  return {
    legal: legalClientContext(request),
    device: clientDeviceContext(request),
    ip: request.ip || null,
  };
}

/** What antibot evaluates. Empty strings count as "not sent". */
export function toSignupContext(input: RegisterInput, meta: SignupRequestMeta): SignupContext {
  return {
    ticket: input.ticket ?? null,
    honeypot: input.website ? input.website : null,
    turnstileToken: input.turnstileToken ?? null,
    attestation: input.attestation ?? null,
    ip: meta.ip,
    userAgent: meta.device.userAgent,
    installationId: meta.device.installationId,
    email: input.email,
    password: input.password,
    channel: meta.legal.channel,
  };
}
