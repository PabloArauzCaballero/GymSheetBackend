import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { env } from '../../config/env';

/**
 * Protects the Prometheus scrape endpoint when `METRICS_SCRAPE_TOKEN` is set.
 *
 * The metrics payload discloses endpoint topology, traffic volume and error
 * windows. Authentication is opt-in so that existing scrape configurations keep
 * working after an upgrade; when the variable is absent the route behaves
 * exactly as before and is expected to be restricted at network level.
 */
@Injectable()
export class MetricsScrapeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedToken = env.METRICS_SCRAPE_TOKEN;

    if (!expectedToken) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authorizationHeader = request.header('authorization') ?? '';
    const presentedToken = authorizationHeader.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length)
      : '';

    if (!this.matchesExpectedToken(presentedToken, expectedToken)) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return true;
  }

  /**
   * Compares in constant time. Lengths are compared first because
   * `timingSafeEqual` throws on mismatched buffers; length alone is not a
   * useful signal for a token of fixed configured size.
   */
  private matchesExpectedToken(presentedToken: string, expectedToken: string): boolean {
    const presented = Buffer.from(presentedToken);
    const expected = Buffer.from(expectedToken);

    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }
}
