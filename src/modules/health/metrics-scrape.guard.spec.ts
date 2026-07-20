import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { env } from '../../config/env';
import { MetricsScrapeGuard } from './metrics-scrape.guard';

const configuredToken = 'a'.repeat(48);

function createContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === 'authorization' ? authorization : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsScrapeGuard', () => {
  const guard = new MetricsScrapeGuard();
  const originalToken = env.METRICS_SCRAPE_TOKEN;

  afterEach(() => {
    (env as { METRICS_SCRAPE_TOKEN?: string }).METRICS_SCRAPE_TOKEN = originalToken;
  });

  function configureToken(token: string | undefined): void {
    (env as { METRICS_SCRAPE_TOKEN?: string }).METRICS_SCRAPE_TOKEN = token;
  }

  it('leaves the endpoint open when no token is configured', () => {
    // Backwards compatibility: an existing deployment that upgrades without
    // setting the variable must keep its scrape configuration working.
    configureToken(undefined);

    expect(guard.canActivate(createContext(undefined))).toBe(true);
  });

  it('admits a scrape presenting the configured token', () => {
    configureToken(configuredToken);

    expect(guard.canActivate(createContext(`Bearer ${configuredToken}`))).toBe(true);
  });

  it.each([
    ['no authorization header', undefined],
    ['an empty bearer', 'Bearer '],
    ['a wrong token of equal length', `Bearer ${'b'.repeat(48)}`],
    ['a truncated token', `Bearer ${configuredToken.slice(0, 40)}`],
    ['a token with trailing padding', `Bearer ${configuredToken}xx`],
    ['the wrong scheme', `Basic ${configuredToken}`],
    ['the raw token without a scheme', configuredToken],
  ])('rejects a scrape with %s', (_label, authorization) => {
    configureToken(configuredToken);

    expect(() => guard.canActivate(createContext(authorization))).toThrow(UnauthorizedException);
  });

  it('does not echo the expected token in the rejection', () => {
    configureToken(configuredToken);

    try {
      guard.canActivate(createContext('Bearer wrong'));
      throw new Error('expected the guard to reject the request');
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(configuredToken);
    }
  });
});
