/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest types response bodies as `any`; these helpers only read ids from them. */
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { CONSENT_VERSIONS, ConsentKind } from '../../src/modules/legal/consent-versions';
import type { E2eApp } from './e2e-app';

/** Typed SELECT against the e2e database, for state the API does not expose. */
export function selectRows<T extends object>(
  e2e: E2eApp,
  statement: string,
  replacements: Record<string, unknown> = {},
): Promise<T[]> {
  return e2e.app.get(Sequelize).query<T>(statement, { type: QueryTypes.SELECT, replacements });
}

/** Grants a consent for its current text version through the public endpoint. */
export async function grantConsent(e2e: E2eApp, token: string, kind: ConsentKind): Promise<void> {
  await e2e.as(token).put(`/me/consents/${kind}`).send({ granted: true, version: CONSENT_VERSIONS[kind] }).expect(200);
}

/** Connects two members (A asks, B accepts) and opens their conversation. */
export async function openConversation(
  e2e: E2eApp,
  a: { token: string },
  b: { token: string; id: string },
): Promise<string> {
  const connected = await e2e.as(a.token).post('/me/connections').send({ addresseeId: b.id }).expect(201);
  await e2e.as(b.token).patch(`/me/connections/${connected.body.data.id as string}`).send({ action: 'ACCEPT' }).expect(200);
  const started = await e2e.as(a.token).post('/me/conversations').send({ otherUserId: b.id }).expect(201);
  return started.body.data.conversationId as string;
}
