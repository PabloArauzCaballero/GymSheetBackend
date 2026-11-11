import { UnauthorizedException } from '@nestjs/common';
import { Transaction } from 'sequelize';
import { RefreshTokenService, hashRefreshToken } from './refresh-token.service';
import {
  NewRefreshToken,
  RefreshTokensRepository,
  StoredRefreshToken,
} from './refresh-tokens.repository';

type Row = StoredRefreshToken & { tokenHash: string; replacedById: string | null };

/** In-memory double with the same semantics as the SQL repository. */
class InMemoryRefreshTokens {
  readonly rows: Row[] = [];

  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return work({} as Transaction);
  }

  insert(token: NewRefreshToken): Promise<void> {
    this.rows.push({ ...token, revokedAt: null, replacedById: null });
    return Promise.resolve();
  }

  findByHashForUpdate(tokenHash: string): Promise<StoredRefreshToken | null> {
    return Promise.resolve(this.rows.find((row) => row.tokenHash === tokenHash) ?? null);
  }

  markRotated(tokenId: string, replacedById: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === tokenId);
    if (row) {
      row.revokedAt = new Date();
      row.replacedById = replacedById;
    }
    return Promise.resolve();
  }

  revokeFamily(familyId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.familyId === familyId && row.revokedAt === null) row.revokedAt = new Date();
    }
    return Promise.resolve();
  }

  live(): Row[] {
    return this.rows.filter((row) => row.revokedAt === null);
  }
}

const USER_ID = '00000000-0000-4000-8000-0000000000aa';
const active = () => Promise.resolve(true);

function setup() {
  const repository = new InMemoryRefreshTokens();
  const service = new RefreshTokenService(repository as unknown as RefreshTokensRepository);
  return { repository, service };
}

describe('RefreshTokenService', () => {
  it('stores only a keyed hash of the token, never the token itself', async () => {
    const { repository, service } = setup();
    const token = await service.issueForNewSession(USER_ID);

    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].tokenHash).toBe(hashRefreshToken(token));
    expect(JSON.stringify(repository.rows)).not.toContain(token);
  });

  it('rotates: the presented token dies and its successor works', async () => {
    const { repository, service } = setup();
    const first = await service.issueForNewSession(USER_ID);

    const rotated = await service.rotate(first, active);

    expect(rotated.userId).toBe(USER_ID);
    expect(rotated.refreshToken).not.toBe(first);
    expect(repository.live()).toHaveLength(1);
    await expect(service.rotate(rotated.refreshToken, active)).resolves.toBeDefined();
  });

  it('slides the expiry forward on every rotation', async () => {
    const { repository, service } = setup();
    const first = await service.issueForNewSession(USER_ID);
    repository.rows[0].expiresAt = new Date(Date.now() + 60_000); // about to expire

    await service.rotate(first, active);

    const successor = repository.live()[0];
    expect(successor.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
  });

  it('reusing a rotated token revokes the whole session, successor included', async () => {
    const { repository, service } = setup();
    const first = await service.issueForNewSession(USER_ID);
    const rotated = await service.rotate(first, active);

    await expect(service.rotate(first, active)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(repository.live()).toHaveLength(0);
    await expect(service.rotate(rotated.refreshToken, active)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const { repository, service } = setup();
    const token = await service.issueForNewSession(USER_ID);
    repository.rows[0].expiresAt = new Date(Date.now() - 1);

    await expect(service.rotate(token, active)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not renew the session of a blocked or deleted account', async () => {
    const { repository, service } = setup();
    const token = await service.issueForNewSession(USER_ID);

    await expect(service.rotate(token, () => Promise.resolve(false))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.live()).toHaveLength(0);
  });

  it('rejects an unknown token', async () => {
    const { service } = setup();
    await expect(service.rotate('not-a-real-refresh-token', active)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logout revokes the session and is idempotent', async () => {
    const { repository, service } = setup();
    const token = await service.issueForNewSession(USER_ID);

    await expect(service.revokeSession(token)).resolves.toBe(true);
    await expect(service.revokeSession(token)).resolves.toBe(false);
    await expect(service.revokeSession('unknown-refresh-token-value')).resolves.toBe(false);
    expect(repository.live()).toHaveLength(0);
    await expect(service.rotate(token, active)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps sessions of other logins independent', async () => {
    const { service } = setup();
    const phone = await service.issueForNewSession(USER_ID);
    const laptop = await service.issueForNewSession(USER_ID);

    await service.revokeSession(phone);

    await expect(service.rotate(laptop, active)).resolves.toBeDefined();
  });
});
