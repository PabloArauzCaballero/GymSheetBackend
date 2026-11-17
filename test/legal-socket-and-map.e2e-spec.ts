import { LEGAL_DOCUMENTS } from '../src/modules/legal/legal-documents';
import { bootE2eApp, E2eApp } from './support/e2e-app';
import { connectChatSocket, emitWithAck, listen } from './support/moderation-e2e';
import { openConversation } from './support/privacy-e2e';

/**
 * "Until you accept, the app does not let you continue" also holds for the
 * chat socket (review-1 #3), the community rules are a versioned document
 * accepted with the others, and the social map follows "if you don't share,
 * you don't see" (review-1 #9).
 */
describe('Legal acceptance on the chat socket, and the social map viewer rule (e2e)', () => {
  let e2e: E2eApp;
  let baseUrl: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    baseUrl = await listen(e2e);
  }, 60000);
  afterAll(async () => e2e?.app.close());
  afterEach(() => jest.restoreAllMocks());

  it('blocks the socket ticket and socket events while COMMUNITY is pending, and allows them after accepting', async () => {
    const sender = await e2e.register('legal-socket-a');
    const peer = await e2e.register('legal-socket-b');
    const conversationId = await openConversation(e2e, sender, peer);
    const pending = await e2e.as(sender.token).get('/me/legal/pending').expect(200);
    expect(pending.body.data.pending).toEqual([]);
    const socket = await connectChatSocket(e2e, baseUrl, sender.token);
    try {
      jest.replaceProperty(LEGAL_DOCUMENTS, 'COMMUNITY', '2099-04-04');

      const ticket = await e2e.as(sender.token).post('/auth/socket-ticket').expect(428);
      expect(ticket.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
      // The socket opened before the bump is checked on every event too.
      await expect(emitWithAck(socket, 'conversation:join', { conversationId }))
        .resolves.toEqual({ joined: false, error: 'legal_acceptance_required' });
      await expect(emitWithAck(socket, 'message:send', { conversationId, body: 'hola' }))
        .resolves.toEqual({ ok: false, error: 'legal_acceptance_required' });
      const listed = await e2e.as(sender.token).get('/me/legal/pending').expect(200);
      expect(listed.body.data.pending).toEqual([{ document: 'COMMUNITY', version: '2099-04-04' }]);

      await e2e.as(sender.token).post('/me/legal/accept')
        .send({ acceptances: [{ document: 'COMMUNITY', version: '2099-04-04' }] }).expect(200);

      await e2e.as(sender.token).post('/auth/socket-ticket').expect(201);
      await expect(emitWithAck(socket, 'conversation:join', { conversationId })).resolves.toEqual({ joined: true });
      await expect(emitWithAck(socket, 'message:send', { conversationId, body: 'hola' }))
        .resolves.toMatchObject({ ok: true });
    } finally {
      socket.disconnect();
    }
  });

  it('records the community rules at signup together with the terms and the privacy policy', async () => {
    const { token } = await e2e.register('legal-community-signup');
    jest.replaceProperty(LEGAL_DOCUMENTS, 'COMMUNITY', '2099-05-05');
    const blocked = await e2e.as(token).get('/users/me').expect(428);
    expect(blocked.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
    jest.restoreAllMocks();
    await e2e.as(token).get('/users/me').expect(200);
  });

  describe('social map', () => {
    const area = '/me/social-map/areas?south=-16.51&west=-68.16&north=-16.49&east=-68.14';
    const peopleViews = [area, '/me/social-map/nearby?latitude=-16.5&longitude=-68.15', '/me/social-map/cells/1:1/people'];

    it.each([
      ['with the social profile and the map off', 'map-viewer-none', null],
      ['with the profile on but the map off', 'map-viewer-nomap', { profileEnabled: true, crossGymEnabled: false, mapEnabled: false, expectedVersion: 0 }],
    ])('refuses to show people on the map to a viewer %s (403 SOCIAL_MAP_DISABLED)', async (_label, label, settings) => {
      const viewer = await e2e.register(label);
      if (settings) await e2e.as(viewer.token).patch('/me/social-discovery-settings').send(settings).expect(200);
      for (const path of peopleViews) {
        const response = await e2e.as(viewer.token).get(path).expect(403);
        expect(response.body.code).toBe('SOCIAL_MAP_DISABLED');
        expect(response.body.detail).toContain('activa tu perfil social y tu visibilidad en el mapa');
      }
    });

    it('shows the map to a viewer who shares it', async () => {
      const viewer = await e2e.register('map-viewer-on');
      await e2e.as(viewer.token).patch('/me/social-discovery-settings')
        .send({ profileEnabled: true, crossGymEnabled: false, mapEnabled: true, expectedVersion: 0 }).expect(200);
      for (const path of peopleViews) await e2e.as(viewer.token).get(path).expect(200);
    });

    it('requires a session (401)', async () => {
      await e2e.as('not-a-token').get(area).expect(401);
    });
  });
});
