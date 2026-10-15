import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/interceptors/response.interceptor';
import { requestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { env } from '../../src/config/env';
import { MEDIA_STORAGE_PROVIDER, MediaStorageProvider } from '../../src/modules/media/media-storage.port';

describe('stories across tenant boundaries (e2e)', () => {
  let application: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let sequelize: Sequelize;
  let temporaryTenantId: string | undefined;
  let viewerEmail: string | undefined;
  let connectionId: string | undefined;
  let secondConnectionId: string | undefined;
  const storedMedia = Buffer.from('story-private-media');
  const mediaProvider: MediaStorageProvider = {
    name: 'local',
    immutable: false,
    upload: jest.fn(async () => ({
      provider: 'local' as const,
      key: 'users/story-owner/stories/selected.jpg',
      url: 'https://public-storage.example/users/story-owner/stories/selected.jpg',
      sizeBytes: storedMedia.byteLength,
      checksumSha256: 'checksum',
      reused: false,
    })),
    download: jest.fn(async () => storedMedia),
    remove: jest.fn(async () => undefined),
  };
  const storyIds: string[] = [];
  const url = (path: string) => `/${env.API_PREFIX}${path}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_PROVIDER)
      .useValue(mediaProvider)
      .compile();
    sequelize = moduleRef.get(Sequelize);
    application = moduleRef.createNestApplication({ bodyParser: false });
    application.setGlobalPrefix(env.API_PREFIX);
    application.use(requestIdMiddleware);
    application.use(json({ limit: env.REQUEST_BODY_LIMIT, strict: true }));
    application.use(urlencoded({ limit: env.REQUEST_BODY_LIMIT, extended: false }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.useGlobalInterceptors(new ResponseInterceptor());
    await application.init();
    httpServer = application.getHttpServer();
  }, 60000);

  afterAll(async () => {
    if (sequelize) {
      if (storyIds.length > 0) {
        await sequelize.query('DELETE FROM profile.stories WHERE id IN (:storyIds)', {
          replacements: { storyIds },
        });
      }
      if (connectionId) {
        await sequelize.query('DELETE FROM social.connections WHERE id = :connectionId', {
          replacements: { connectionId },
        });
      }
      if (secondConnectionId) {
        await sequelize.query('DELETE FROM social.connections WHERE id = :connectionId', {
          replacements: { connectionId: secondConnectionId },
        });
      }
      if (temporaryTenantId) {
        if (viewerEmail) {
          await sequelize.query(
            'UPDATE public.usuarios SET tenant_id = :defaultTenantId WHERE email = :viewerEmail AND tenant_id = :temporaryTenantId',
            { replacements: { defaultTenantId: env.DEFAULT_TENANT_ID, viewerEmail, temporaryTenantId } },
          );
        }
        await sequelize.query('DELETE FROM public.tenants WHERE id = :temporaryTenantId', {
          replacements: { temporaryTenantId },
        });
      }
    }
    await application?.close();
  });

  it('H8.S1.M2 selected audience blocks an unselected connection; H8.S1.M4 limits viewers to the owner; H8.S2.M1 reaction retries create one chat message; H8.S2.M2 delivers a text reply with its story reference; H8.S2.M3 marks expired or purged references unavailable; H8.S2.M4 rejects reaction after disconnect without creating chat; H8.S3.M3 upload retries are owner-scoped and content-idempotent; H8.S3.M4 deletion revokes feed, view, media, and audience access', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    temporaryTenantId = `stories-e2e-${suffix}`;
    viewerEmail = `stories-viewer-${suffix}@example.test`;
    await sequelize.query(
      `INSERT INTO public.tenants (id, nombre, estado)
       VALUES (:tenantId, 'Stories e2e', 'ACTIVO')`,
      { replacements: { tenantId: temporaryTenantId } },
    );

    const register = async (label: string, email?: string) => {
      const response = await request(httpServer)
        .post(url('/auth/register'))
        .send({
          email: email ?? `stories-${label}-${suffix}@example.test`,
          password: 'stories-e2e-password',
          nombreCompleto: `Stories ${label} ${suffix}`,
          acceptedTerms: true,
        })
        .expect(201);
      return {
        accessToken: response.body.data.accessToken as string,
        userId: response.body.data.user.id as string,
      };
    };

    const owner = await register('owner');
    const viewer = await register('viewer', viewerEmail);
    const stranger = await register('stranger');
    await sequelize.query(
      'UPDATE public.usuarios SET tenant_id = :tenantId WHERE id = :viewerId',
      { replacements: { tenantId: temporaryTenantId, viewerId: viewer.userId } },
    );
    const [viewerTenant] = await sequelize.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM public.usuarios WHERE id = :viewerId',
      { type: QueryTypes.SELECT, replacements: { viewerId: viewer.userId } },
    );
    expect(viewerTenant.tenant_id).toBe(temporaryTenantId);

    const [connection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:ownerId, :viewerId, 'ACCEPTED', now())
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { ownerId: owner.userId, viewerId: viewer.userId } },
    );
    connectionId = connection.id;
    const [secondConnection] = await sequelize.query<{ id: string }>(
      `INSERT INTO social.connections (requester_id, addressee_id, status, responded_at)
       VALUES (:ownerId, :strangerId, 'ACCEPTED', now())
       RETURNING id`,
      { type: QueryTypes.SELECT, replacements: { ownerId: owner.userId, strangerId: stranger.userId } },
    );
    secondConnectionId = secondConnection.id;

    const [activeStory] = await sequelize.query<{ id: string }>(
      `INSERT INTO profile.stories
         (user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
       VALUES
         (:ownerId, :tenantId, 'https://example.test/active-story.jpg', 'LOCAL', :activeKey, 'image', now() + interval '1 hour')
       RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: { ownerId: owner.userId, tenantId: env.DEFAULT_TENANT_ID, activeKey: `stories/${suffix}/active` },
      },
    );
    storyIds.push(activeStory.id);

    const [expiredStory] = await sequelize.query<{ id: string }>(
      `INSERT INTO profile.stories
         (user_id, tenant_id, media_url, storage_provider, storage_key, media_type, expires_at)
       VALUES
         (:ownerId, :tenantId, 'https://example.test/expired-story.jpg', 'LOCAL', :expiredKey, 'image', now() - interval '1 hour')
       RETURNING id`,
      {
        type: QueryTypes.SELECT,
        replacements: { ownerId: owner.userId, tenantId: env.DEFAULT_TENANT_ID, expiredKey: `stories/${suffix}/expired` },
      },
    );
    storyIds.push(expiredStory.id);

    // H8.S1.M2: B is explicitly selected; C remains an accepted connection but
    // must not learn the story from feed, view receipt, ID endpoint, or media URL.
    const uploadRequestId = randomUUID();
    const selectedUpload = await request(httpServer)
      .post(url('/me/stories'))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('requestId', uploadRequestId)
      .field('audienceMode', 'SELECTED_CONNECTIONS')
      .field('recipientIds', JSON.stringify([viewer.userId]))
      .attach('file', Buffer.from('upload'), { filename: 'selected.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const selectedStoryId = selectedUpload.body.data.id as string;
    storyIds.push(selectedStoryId);
    expect(selectedUpload.body.data.mediaUrl).toBe(`/me/stories/${selectedStoryId}/media`);
    expect(selectedUpload.body.data.mediaUrl).not.toContain('public-storage.example');

    // H8.S3.M3: retries by the same owner and request key return the original
    // story without re-uploading or replacing its selected audience.
    const uploadsBeforeReplay = (mediaProvider.upload as jest.Mock).mock.calls.length;
    const replay = await request(httpServer)
      .post(url('/me/stories'))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('requestId', uploadRequestId)
      .attach('file', Buffer.from('upload'), { filename: 'retry.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(replay.body.data.id).toBe(selectedStoryId);
    expect((mediaProvider.upload as jest.Mock).mock.calls).toHaveLength(uploadsBeforeReplay);
    const selectedAudience = await sequelize.query<{ user_id: string }>(
      'SELECT user_id FROM profile.story_audiences WHERE story_id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: selectedStoryId } },
    );
    expect(selectedAudience.map((row) => row.user_id)).toEqual([viewer.userId]);

    await request(httpServer)
      .post(url('/me/stories'))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('requestId', uploadRequestId)
      .attach('file', Buffer.from('different-upload'), { filename: 'different.jpg', contentType: 'image/jpeg' })
      .expect(409);
    const requestsForOwner = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM profile.stories
        WHERE user_id = :userId AND upload_request_id = :requestId`,
      { type: QueryTypes.SELECT, replacements: { userId: owner.userId, requestId: uploadRequestId } },
    );
    expect(requestsForOwner[0].count).toBe('1');

    // A new key creates a new story; the same key is independently available
    // to another owner.
    const distinctRequestId = randomUUID();
    const distinctUpload = await request(httpServer)
      .post(url('/me/stories'))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('requestId', distinctRequestId)
      .attach('file', Buffer.from('upload'), { filename: 'selected.jpg', contentType: 'image/jpeg' })
      .expect(201);
    storyIds.push(distinctUpload.body.data.id as string);
    expect(distinctUpload.body.data.id).not.toBe(selectedStoryId);

    const otherOwnerUpload = await request(httpServer)
      .post(url('/me/stories'))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .field('requestId', uploadRequestId)
      .attach('file', Buffer.from('upload'), { filename: 'other-owner.jpg', contentType: 'image/jpeg' })
      .expect(201);
    storyIds.push(otherOwnerUpload.body.data.id as string);
    expect(otherOwnerUpload.body.data.id).not.toBe(selectedStoryId);

    const viewerFeed = await request(httpServer)
      .get(url('/me/stories/feed'))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    const viewerOwnerEntry = (viewerFeed.body.data as Array<{ userId: string; stories: Array<{ id: string }> }>)
      .find((entry) => entry.userId === owner.userId);
    expect(viewerOwnerEntry?.stories.map((story) => story.id)).toContain(selectedStoryId);

    const strangerFeed = await request(httpServer)
      .get(url('/me/stories/feed'))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(200);
    const strangerOwnerEntry = (strangerFeed.body.data as Array<{ userId: string; stories: Array<{ id: string }> }>)
      .find((entry) => entry.userId === owner.userId);
    expect(strangerOwnerEntry?.stories.map((story) => story.id)).not.toContain(selectedStoryId);

    await request(httpServer)
      .post(url(`/me/stories/${selectedStoryId}/view`))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
    const excludedViews = await sequelize.query<{ viewer_id: string }>(
      'SELECT viewer_id FROM profile.story_views WHERE story_id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: selectedStoryId } },
    );
    expect(excludedViews).toHaveLength(0);

    await request(httpServer)
      .get(url(`/me/stories/${selectedStoryId}/media`))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
    expect(mediaProvider.download).not.toHaveBeenCalled();

    const selectedMedia = await request(httpServer)
      .get(url(`/me/stories/${selectedStoryId}/media`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    expect(selectedMedia.body).toEqual(storedMedia);
    expect(mediaProvider.download).toHaveBeenCalledTimes(1);

    // H8.S3.M4: prove the viewer had feed, view receipt and media access, then
    // delete as the author and verify all access paths and audience rows vanish.
    const revocationUpload = await request(httpServer)
      .post(url('/me/stories'))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('audienceMode', 'SELECTED_CONNECTIONS')
      .field('recipientIds', JSON.stringify([viewer.userId]))
      .attach('file', Buffer.from('delete-after-view'), { filename: 'revocation.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const revocationStoryId = revocationUpload.body.data.id as string;
    storyIds.push(revocationStoryId);

    const feedBeforeDelete = await request(httpServer)
      .get(url('/me/stories/feed'))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    const ownerEntryBeforeDelete = (feedBeforeDelete.body.data as Array<{
      userId: string; stories: Array<{ id: string }>;
    }>).find((entry) => entry.userId === owner.userId);
    expect(ownerEntryBeforeDelete?.stories.map((story) => story.id)).toContain(revocationStoryId);

    await request(httpServer)
      .post(url(`/me/stories/${revocationStoryId}/view`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(201);
    const mediaBeforeDelete = await request(httpServer)
      .get(url(`/me/stories/${revocationStoryId}/media`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    expect(mediaBeforeDelete.body).toEqual(storedMedia);
    expect(mediaProvider.download).toHaveBeenCalledTimes(2);

    await request(httpServer)
      .delete(url(`/me/stories/${revocationStoryId}`))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual({ deleted: true }));

    const feedAfterDelete = await request(httpServer)
      .get(url('/me/stories/feed'))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    const ownerEntryAfterDelete = (feedAfterDelete.body.data as Array<{
      userId: string; stories: Array<{ id: string }>;
    }>).find((entry) => entry.userId === owner.userId);
    expect(ownerEntryAfterDelete?.stories.map((story) => story.id) ?? []).not.toContain(revocationStoryId);

    await request(httpServer)
      .post(url(`/me/stories/${revocationStoryId}/view`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(404);
    await request(httpServer)
      .get(url(`/me/stories/${revocationStoryId}/media`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(404);
    expect(mediaProvider.download).toHaveBeenCalledTimes(2);

    const remainingDeletedStoryRows = await sequelize.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM profile.stories WHERE id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: revocationStoryId } },
    );
    const remainingDeletedStoryAudience = await sequelize.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM profile.story_audiences WHERE story_id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: revocationStoryId } },
    );
    const remainingDeletedStoryViews = await sequelize.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM profile.story_views WHERE story_id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: revocationStoryId } },
    );
    expect(remainingDeletedStoryRows[0].count).toBe('0');
    expect(remainingDeletedStoryAudience[0].count).toBe('0');
    expect(remainingDeletedStoryViews[0].count).toBe('0');

    const reactionRequestId = 'ce31c8b4-9ecc-4cc1-a8ac-2eb93c78d4a6';
    const reactionPayload = { emoji: '💪', requestId: reactionRequestId };
    const firstReaction = await request(httpServer)
      .post(url(`/me/stories/${selectedStoryId}/reactions`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send(reactionPayload)
      .expect(201);
    const retriedReaction = await request(httpServer)
      .post(url(`/me/stories/${selectedStoryId}/reactions`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send(reactionPayload)
      .expect(201);

    expect(retriedReaction.body.data.id).toBe(firstReaction.body.data.id);
    expect(retriedReaction.body.data.conversationId).toBe(firstReaction.body.data.conversationId);
    const [reactionCount] = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM chat.messages
        WHERE conversation_id = :conversationId
          AND sender_id = :senderId
          AND client_request_id = :requestId`,
      {
        type: QueryTypes.SELECT,
        replacements: {
          conversationId: firstReaction.body.data.conversationId,
          senderId: viewer.userId,
          requestId: reactionRequestId,
        },
      },
    );
    expect(reactionCount.count).toBe('1');

    const replyRequestId = 'ea8dcb40-3b26-4e3e-a7e4-c751df4c8f53';
    const replyText = '¡Qué buena historia!';
    const storyReply = await request(httpServer)
      .post(url(`/me/stories/${selectedStoryId}/replies`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ text: replyText, requestId: replyRequestId })
      .expect(201);
    expect(storyReply.body.data).toMatchObject({
      body: replyText,
      type: 'text',
      storyReference: { storyId: selectedStoryId },
    });
    const [persistedReply] = await sequelize.query<{ body: string; story_id: string }>(
      `SELECT body, story_id FROM chat.messages WHERE id = :messageId`,
      { type: QueryTypes.SELECT, replacements: { messageId: storyReply.body.data.id } },
    );
    expect(persistedReply).toEqual({ body: replyText, story_id: selectedStoryId });

    const storyAvailabilityQuerySpy = jest.spyOn(sequelize, 'query');
    const ownerMessages = await request(httpServer)
      .get(url(`/me/conversations/${storyReply.body.data.conversationId}/messages`))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const storyAvailabilityQueries = storyAvailabilityQuerySpy.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && sql.includes('FROM profile.stories') && sql.includes('WHERE id IN'),
    );
    expect(storyAvailabilityQueries).toHaveLength(1);
    storyAvailabilityQuerySpy.mockRestore();
    expect(ownerMessages.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: storyReply.body.data.id,
        body: replyText,
        storyReference: { storyId: selectedStoryId, available: true },
      }),
    ]));
    const deliveredReply = (ownerMessages.body.data as Array<{
      id: string; body: string; mediaUrl: string | null; storyReference: { storyId: string; available: boolean } | null;
    }>).find((message) => message.id === storyReply.body.data.id);
    expect(deliveredReply?.body).toBe(replyText);
    expect(deliveredReply?.mediaUrl).toBeNull();
    expect(deliveredReply?.storyReference).toEqual({ storyId: selectedStoryId, available: true });

    await sequelize.query(
      `UPDATE profile.stories SET hidden_at = now() WHERE id = :storyId`,
      { replacements: { storyId: selectedStoryId } },
    );
    const hiddenReplyHistory = await request(httpServer)
      .get(url(`/me/conversations/${storyReply.body.data.conversationId}/messages`))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const hiddenReply = (hiddenReplyHistory.body.data as Array<{
      id: string; body: string; storyReference: { storyId: string; available: boolean } | null;
    }>).find((message) => message.id === storyReply.body.data.id);
    expect(hiddenReply).toMatchObject({
      body: replyText,
      storyReference: { storyId: selectedStoryId, available: false },
    });

    const feed = await request(httpServer)
      .get(url('/me/stories/feed'))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);
    const ownerEntry = (feed.body.data as Array<{ userId: string; stories: Array<{ id: string }> }>).find(
      (entry) => entry.userId === owner.userId,
    );
    expect(ownerEntry?.stories.map((story) => story.id)).toContain(activeStory.id);
    expect(ownerEntry?.stories.map((story) => story.id)).not.toContain(expiredStory.id);

    await request(httpServer)
      .post(url(`/me/stories/${activeStory.id}/view`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(201);
    const activeViews = await sequelize.query<{ viewer_id: string }>(
      'SELECT viewer_id FROM profile.story_views WHERE story_id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: activeStory.id } },
    );
    expect(activeViews).toEqual([{ viewer_id: viewer.userId }]);

    await request(httpServer)
      .get(url(`/me/stories/${activeStory.id}/viewers`))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          storyId: activeStory.id,
          total: 1,
          viewers: [expect.objectContaining({ userId: viewer.userId })],
        });
      });

    // Un tercero que conoce el UUID no puede confirmar que la historia existe
    // ni consultar la lista de espectadores.
    await request(httpServer)
      .get(url(`/me/stories/${activeStory.id}/viewers`))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);

    await request(httpServer)
      .post(url(`/me/stories/${expiredStory.id}/view`))
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(404);
    const expiredViews = await sequelize.query<{ viewer_id: string }>(
      'SELECT viewer_id FROM profile.story_views WHERE story_id = :storyId',
      { type: QueryTypes.SELECT, replacements: { storyId: expiredStory.id } },
    );
    expect(expiredViews).toHaveLength(0);

    await sequelize.query(
      `UPDATE profile.stories SET expires_at = now() - interval '1 minute' WHERE id = :storyId`,
      { replacements: { storyId: selectedStoryId } },
    );
    const expiredReplyHistory = await request(httpServer)
      .get(url(`/me/conversations/${storyReply.body.data.conversationId}/messages`))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const expiredReply = (expiredReplyHistory.body.data as Array<{
      id: string; body: string; storyReference: { storyId: string; available: boolean } | null;
    }>).find((message) => message.id === storyReply.body.data.id);
    expect(expiredReply).toMatchObject({
      body: replyText,
      storyReference: { storyId: selectedStoryId, available: false },
    });

    await sequelize.query('DELETE FROM profile.stories WHERE id = :storyId', {
      replacements: { storyId: selectedStoryId },
    });
    const purgedReplyHistory = await request(httpServer)
      .get(url(`/me/conversations/${storyReply.body.data.conversationId}/messages`))
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const purgedReply = (purgedReplyHistory.body.data as Array<{
      id: string; body: string; storyReference: { storyId: string; available: boolean } | null;
    }>).find((message) => message.id === storyReply.body.data.id);
    expect(purgedReply).toMatchObject({
      body: replyText,
      storyReference: { storyId: selectedStoryId, available: false },
    });

    // Simulate a stale client cache: stranger receives the active story, then
    // the accepted connection is removed before the reaction reaches the API.
    const staleFeed = await request(httpServer)
      .get(url('/me/stories/feed'))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(200);
    const staleOwnerEntry = (staleFeed.body.data as Array<{ userId: string; stories: Array<{ id: string }> }>).find(
      (entry) => entry.userId === owner.userId,
    );
    expect(staleOwnerEntry?.stories.map((story) => story.id)).toContain(activeStory.id);

    await sequelize.query('DELETE FROM social.connections WHERE id = :connectionId', {
      replacements: { connectionId: secondConnectionId },
    });
    secondConnectionId = undefined;

    const reactionRequestIdAfterDisconnect = '8d5a0874-5ecc-4cd1-9d89-0f27d85ab4c3';
    await request(httpServer)
      .post(url(`/me/stories/${activeStory.id}/reactions`))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({ emoji: '💪', requestId: reactionRequestIdAfterDisconnect })
      .expect(404);

    const conversationsAfterDisconnect = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM chat.participants p1
         JOIN chat.participants p2 ON p1.conversation_id = p2.conversation_id
        WHERE p1.user_id = :ownerId AND p2.user_id = :strangerId`,
      { type: QueryTypes.SELECT, replacements: { ownerId: owner.userId, strangerId: stranger.userId } },
    );
    expect(conversationsAfterDisconnect[0].count).toBe('0');

    const messagesAfterDisconnect = await sequelize.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM chat.messages m
        WHERE m.conversation_id IN (
          SELECT p1.conversation_id
            FROM chat.participants p1
            JOIN chat.participants p2 ON p1.conversation_id = p2.conversation_id
           WHERE p1.user_id = :ownerId AND p2.user_id = :strangerId
        )`,
      { type: QueryTypes.SELECT, replacements: { ownerId: owner.userId, strangerId: stranger.userId } },
    );
    expect(messagesAfterDisconnect[0].count).toBe('0');

  }, 60000);
});
