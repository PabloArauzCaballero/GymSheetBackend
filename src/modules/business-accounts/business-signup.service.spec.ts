import { env } from '../../config/env';
import { businessSignupOpen, resolveLegalKind } from './business-signup.service';

describe('business signup rules (ADR-0020)', () => {
  const original = { enabled: env.BUSINESS_SIGNUP_ENABLED, nodeEnv: env.NODE_ENV };
  afterEach(() => {
    env.BUSINESS_SIGNUP_ENABLED = original.enabled;
    env.NODE_ENV = original.nodeEnv;
  });

  it('is closed by default', () => {
    env.BUSINESS_SIGNUP_ENABLED = false;
    expect(businessSignupOpen()).toBe(false);
  });

  it('opens with the flag outside production', () => {
    env.BUSINESS_SIGNUP_ENABLED = true;
    env.NODE_ENV = 'test';
    expect(businessSignupOpen()).toBe(true);
  });

  it('stays closed in production while the business legal texts are drafts', () => {
    env.BUSINESS_SIGNUP_ENABLED = true;
    env.NODE_ENV = 'production';
    expect(businessSignupOpen()).toBe(false);
  });

  it('fixes the legal kind by type and lets only SERVICE_PROVIDER choose', () => {
    expect(resolveLegalKind('GYM')).toBe('COMPANY');
    expect(resolveLegalKind('STORE', 'COMPANY')).toBe('COMPANY');
    expect(resolveLegalKind('COACH')).toBe('INDIVIDUAL');
    expect(resolveLegalKind('SERVICE_PROVIDER', 'INDIVIDUAL')).toBe('INDIVIDUAL');
    expect(() => resolveLegalKind('SERVICE_PROVIDER')).toThrow(expect.objectContaining({ code: 'BUSINESS_LEGAL_KIND_INVALID' }));
    expect(() => resolveLegalKind('COACH', 'COMPANY')).toThrow(expect.objectContaining({ code: 'BUSINESS_LEGAL_KIND_INVALID' }));
  });
});
