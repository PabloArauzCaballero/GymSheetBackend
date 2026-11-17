/* eslint-disable @typescript-eslint/no-unsafe-member-access --
   supertest types response bodies as `any`; these helpers only read fields from them. */
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import type { E2eApp } from './e2e-app';

export type Member = { token: string; id: string };

/** Registers a member of the central REPP moderation team (cross-gym queue, ADR-0018). */
export async function registerModerator(e2e: E2eApp, label: string): Promise<Member> {
  const moderator = await e2e.register(label);
  await e2e.promote(moderator.id, 'MODERATOR');
  return moderator;
}

/** The member's in-app inbox as raw items (subject, body, type and refs). */
export async function inbox(
  e2e: E2eApp,
  token: string,
): Promise<{ asunto: string | null; mensaje: string; tipo: string | null }[]> {
  const response = await e2e.as(token).get('/notifications/me').expect(200);
  return response.body.data.items as { asunto: string | null; mensaje: string; tipo: string | null }[];
}

/** Claims and resolves a moderation case in one go. */
export async function resolveCase(
  e2e: E2eApp,
  moderator: Member,
  target: { kind: string; id: string },
  decision: { hideContent?: boolean; sanction?: boolean; confirmMinor?: boolean; suspendBusiness?: boolean; note?: string },
) {
  const base = `/admin/moderation/cases/${target.kind}/${target.id}`;
  await e2e.as(moderator.token).post(`${base}/claim`).expect(201);
  return e2e.as(moderator.token).post(`${base}/resolve`).send(decision).expect(201);
}

/** Starts listening on a random port (sockets need a real server) and returns its base URL. */
export async function listen(e2e: E2eApp): Promise<string> {
  await e2e.app.listen(0);
  const server = e2e.app.getHttpServer() as Server;
  const address = server.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

/** Exchanges a socket ticket and opens the chat socket for the member. */
export async function connectChatSocket(e2e: E2eApp, baseUrl: string, token: string): Promise<Socket> {
  const issued = await e2e.as(token).post('/auth/socket-ticket').expect(201);
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/chat`, { auth: { ticket: issued.body.data.ticket as string }, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

/** Emits an event and waits for its acknowledgement. */
export function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (ack: T) => resolve(ack)));
}
