import type { SignupRequestMeta } from '../../../modules/auth/signup-context';

/** Request metadata of a seed signup: no client, no device, no IP. */
export const SEED_SIGNUP_META: SignupRequestMeta = {
  legal: { channel: 'UNKNOWN', ipHmac: null, userAgent: null },
  device: {
    installationId: null,
    platform: 'UNKNOWN',
    appVersion: null,
    osVersion: null,
    deviceModel: null,
    userAgent: null,
    ipHmac: null,
  },
  ip: null,
  // Seeds create demo accounts on purpose: audited, but not run through the human-signup checks.
  internal: true,
};
