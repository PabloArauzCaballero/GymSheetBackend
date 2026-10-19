import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaRetentionService } from "../media/media-retention.service";
import { MediaStorageProvider } from "../media/media-storage.port";
import { StoriesRepository, StoryFeedRow } from "./stories.repository";
import { StoriesService, storyMediaEtag } from "./stories.service";

const userId = "00000000-0000-4000-8000-00000000000a";
const viewerId = "00000000-0000-4000-8000-00000000000a";
const matchId = "00000000-0000-4000-8000-00000000000b";
const otherMatchId = "00000000-0000-4000-8000-00000000000c";
const strangerId = "00000000-0000-4000-8000-00000000000d";
const transaction = { id: "tx" } as unknown as Transaction;

function createService(
  repositoryOverrides: Partial<StoriesRepository>,
  mediaStorageOverrides: Partial<MediaStorageProvider> = {},
  // ¿Queda otra fila (otra story, una foto de perfil, un mensaje…) apuntando
  // al mismo binario? Es lo que decide si el fichero se borra o se conserva.
  referencedElsewhere = false,
): StoriesService {
  const storage = {
    name: "local",
    upload: jest.fn().mockResolvedValue({
      provider: "local",
      key: "stories/some-key.jpg",
      url: "http://localhost:3000/media/stories/some-key.jpg",
      sizeBytes: 100,
      checksumSha256: "checksum",
      reused: false,
    }),
    remove: jest.fn(),
    ...mediaStorageOverrides,
  } as unknown as MediaStorageProvider;

  const retention = new MediaRetentionService(
    {
      transaction: jest.fn(
        async (run: (t: Transaction) => Promise<unknown>) => run(transaction),
      ),
    } as unknown as Sequelize,
    {
      lockStorageKey: jest.fn().mockResolvedValue(undefined),
      isReferenced: jest.fn().mockResolvedValue(referencedElsewhere),
    } as unknown as MediaReferencesRepository,
    storage,
  );

  return new StoriesService(
    {
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
      isSelectedRecipient: jest.fn().mockResolvedValue(false),
      ...repositoryOverrides,
    } as StoriesRepository,
    storage,
    retention,
  );
}

describe("StoriesService.upload", () => {
  const file = { originalname: "story.jpg", mimetype: "image/jpeg", size: 1024, buffer: Buffer.from("x") };

  it("rejects an empty file", async () => {
    const service = createService({});
    await expect(service.upload(userId, "default", undefined)).rejects.toThrow(BadRequestException);
  });

  it("rejects a disallowed mime type", async () => {
    const service = createService({});
    await expect(
      service.upload(userId, "default", { ...file, mimetype: "application/zip" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("infers media type from the mime type and stores the story", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "story-1",
      mediaUrl: "http://localhost:3000/media/stories/some-key.jpg",
      mediaType: "image",
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
      expiresAt: new Date("2026-08-29T00:00:00.000Z"),
    });
    const service = createService({ create });

    const result = await service.upload(userId, "default", file);

    expect(create).toHaveBeenCalledWith(userId, "default", expect.any(Object), "image", "ALL_CONNECTIONS", [], undefined, null);
    expect(result.mediaType).toBe("image");
    expect(result.mediaUrl).toContain("/me/stories/story-1/media");
  });

  it("persists only a validated selected audience", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "story-1", mediaType: "image", createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    const validAudienceRecipients = jest.fn().mockResolvedValue([matchId]);
    const service = createService({ create, validAudienceRecipients });
    await service.upload(userId, "default", file, {
      audienceMode: "SELECTED_CONNECTIONS",
      recipientIds: JSON.stringify([matchId]),
    });
    expect(validAudienceRecipients).toHaveBeenCalledWith(userId, [matchId]);
    expect(create).toHaveBeenCalledWith(userId, "default", expect.any(Object), "image", "SELECTED_CONNECTIONS", [matchId], undefined, null);
  });

  it("stores a trimmed caption and returns it", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "story-1", mediaType: "image", caption: "Día de pierna", createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    const service = createService({ create });
    const result = await service.upload(userId, "default", file, { caption: "  Día de pierna\u0007  " });
    expect(create).toHaveBeenCalledWith(userId, "default", expect.any(Object), "image", "ALL_CONNECTIONS", [], undefined, "Día de pierna");
    expect(result.caption).toBe("Día de pierna");
  });

  it("rejects a caption that is too long or has too many lines, before uploading the file", async () => {
    const upload = jest.fn();
    const service = createService({}, { upload });
    await expect(service.upload(userId, "default", file, { caption: "x".repeat(201) })).rejects.toThrow(BadRequestException);
    await expect(service.upload(userId, "default", file, { caption: "a\nb\nc\nd\ne" })).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns the prior story for the same owner, request id, and file hash without uploading again", async () => {
    const requestId = randomUUID();
    const previous = {
      id: "story-existing",
      userId,
      uploadContentHash: createHash("sha256").update(file.buffer).digest("hex"),
      mediaUrl: "https://localhost/story-existing",
      mediaType: "image",
      audienceMode: "SELECTED_CONNECTIONS",
      createdAt: new Date("2026-10-10T00:00:00.000Z"),
      expiresAt: new Date("2026-10-11T00:00:00.000Z"),
    };
    const findByUploadRequest = jest.fn().mockResolvedValue(previous);
    const upload = jest.fn();
    const service = createService({ findByUploadRequest }, { upload });

    const result = await service.upload(userId, "default", file, {
      requestId,
      audienceMode: "ALL_CONNECTIONS",
    });

    expect(result.id).toBe(previous.id);
    expect(findByUploadRequest).toHaveBeenCalledWith(userId, requestId);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a request id reused with different file bytes before uploading", async () => {
    const requestId = randomUUID();
    const previous = {
      id: "story-existing",
      uploadContentHash: createHash("sha256").update("another file").digest("hex"),
    };
    const upload = jest.fn();
    const service = createService(
      { findByUploadRequest: jest.fn().mockResolvedValue(previous) },
      { upload },
    );

    await expect(service.upload(userId, "default", file, { requestId })).rejects.toThrow(ConflictException);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a malformed upload request id", async () => {
    const upload = jest.fn();
    const service = createService({}, { upload });

    await expect(service.upload(userId, "default", file, { requestId: "not-a-uuid" })).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a selected recipient without a current accepted connection before storing media", async () => {
    const upload = jest.fn();
    const service = createService({ validAudienceRecipients: jest.fn().mockResolvedValue([]) }, { upload });
    await expect(service.upload(userId, "default", file, {
      audienceMode: "SELECTED_CONNECTIONS", recipientIds: [matchId],
    })).rejects.toThrow(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("StoriesService.view", () => {
  it("rejects viewing a story that does not exist", async () => {
    const service = createService({ findById: jest.fn().mockResolvedValue(null) });
    await expect(service.view("story-1", userId)).rejects.toThrow(NotFoundException);
  });

  it("rejects viewing a story from another tenant when there is no accepted connection", async () => {
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "other-gym", userId: matchId }),
      hasAcceptedConnection: jest.fn().mockResolvedValue(false),
    });
    await expect(service.view("story-1", userId)).rejects.toThrow(NotFoundException);
  });

  it("rejects an expired story without recording a view", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      findById: jest.fn().mockResolvedValue({
        id: "story-1",
        tenantId: "default",
        userId: userId,
        expiresAt: new Date(Date.now() - 1),
      }),
      recordView,
    });

    await expect(service.view("story-1", userId)).rejects.toThrow(NotFoundException);
    expect(recordView).not.toHaveBeenCalled();
  });

  it("answers 404 — not 403 — when the viewer has no accepted connection with the author", async () => {
    // La laguna que cerró D-3: sin esta comprobación, quien no es match no veía
    // la story en su feed pero sí podía marcarla como vista conociendo el id, y
    // aparecía con nombre y foto en la lista de espectadores del autor.
    const recordView = jest.fn().mockResolvedValue(undefined);
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "default", userId: strangerId }),
      hasAcceptedConnection: jest.fn().mockResolvedValue(false),
      recordView,
    });

    await expect(service.view("story-1", userId)).rejects.toThrow(NotFoundException);
    expect(recordView).not.toHaveBeenCalled();
  });

  it("records the view of a match's story", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const hasAcceptedConnection = jest.fn().mockResolvedValue(true);
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "default", userId: matchId, expiresAt: new Date(Date.now() + 60_000), audienceMode: "ALL_CONNECTIONS", hiddenAt: null }),
      hasAcceptedConnection,
      recordView,
    });

    await expect(service.view("story-1", userId)).resolves.toEqual({ recorded: true });

    expect(hasAcceptedConnection).toHaveBeenCalledWith(userId, matchId);
    expect(recordView).toHaveBeenCalledWith("story-1", userId);
  });

  it("records a connected viewer's view of a story from another tenant", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const hasAcceptedConnection = jest.fn().mockResolvedValue(true);
    const service = createService({
      findById: jest.fn().mockResolvedValue({
        id: "story-1",
        tenantId: "other-gym",
        userId: matchId,
        expiresAt: new Date(Date.now() + 60_000),
        audienceMode: "ALL_CONNECTIONS",
        hiddenAt: null,
      }),
      hasAcceptedConnection,
      recordView,
    });

    await expect(service.view("story-1", userId)).resolves.toEqual({ recorded: true });
    expect(hasAcceptedConnection).toHaveBeenCalledWith(userId, matchId);
    expect(recordView).toHaveBeenCalledWith("story-1", userId);
  });

  it("returns 404 to a connected but unselected viewer without recording the view", async () => {
    const recordView = jest.fn();
    const service = createService({
      findById: jest.fn().mockResolvedValue({
        id: "story-1", userId: matchId, expiresAt: new Date(Date.now() + 60_000),
        hiddenAt: null, audienceMode: "SELECTED_CONNECTIONS",
      }),
      hasAcceptedConnection: jest.fn().mockResolvedValue(true),
      isSelectedRecipient: jest.fn().mockResolvedValue(false),
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
      recordView,
    });
    await expect(service.view("story-1", userId)).rejects.toThrow(NotFoundException);
    expect(recordView).not.toHaveBeenCalled();
  });

  it("revalidates audience before loading story bytes", async () => {
    const download = jest.fn().mockResolvedValue(Buffer.from("private"));
    const service = createService({
      findById: jest.fn().mockResolvedValue({
        id: "story-1", userId: matchId, storageKey: "users/owner/stories/a.jpg",
        expiresAt: new Date(Date.now() + 60_000), hiddenAt: null, audienceMode: "SELECTED_CONNECTIONS",
      }),
      hasAcceptedConnection: jest.fn().mockResolvedValue(true),
      isSelectedRecipient: jest.fn().mockResolvedValue(false),
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
    }, { download });
    await expect(service.downloadMedia("story-1", userId)).rejects.toThrow(NotFoundException);
    expect(download).not.toHaveBeenCalled();
  });

  it("serves bytes to a selected recipient through the authorized media path", async () => {
    const bytes = Buffer.from("private");
    const download = jest.fn().mockResolvedValue(bytes);
    const service = createService({
      findById: jest.fn().mockResolvedValue({
        id: "story-1", userId: matchId, storageKey: "users/owner/stories/a.jpg",
        expiresAt: new Date(Date.now() + 60_000), hiddenAt: null, audienceMode: "SELECTED_CONNECTIONS",
      }),
      hasAcceptedConnection: jest.fn().mockResolvedValue(true),
      isSelectedRecipient: jest.fn().mockResolvedValue(true),
      isBlockedEitherWay: jest.fn().mockResolvedValue(false),
    }, { download });
    await expect(service.downloadMedia("story-1", userId)).resolves.toEqual({ buffer: bytes, mimeType: "image/jpeg", etag: storyMediaEtag("users/owner/stories/a.jpg") });
    expect(download).toHaveBeenCalledWith("users/owner/stories/a.jpg");
  });

  it("records the view of an own story without asking about connections", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const hasAcceptedConnection = jest.fn();
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "default", userId, expiresAt: new Date(Date.now() + 60_000), audienceMode: "SELECTED_CONNECTIONS", hiddenAt: null }),
      hasAcceptedConnection,
      recordView,
    });

    await service.view("story-1", userId);

    expect(hasAcceptedConnection).not.toHaveBeenCalled();
    expect(recordView).toHaveBeenCalledWith("story-1", userId);
  });
});

describe("StoriesService.remove", () => {
  it("rejects removing a story the caller does not own", async () => {
    const service = createService({ findByIdForUser: jest.fn().mockResolvedValue(null) });
    await expect(service.remove("story-1", userId)).rejects.toThrow(NotFoundException);
  });

  it("removes the stored media and the story row when nothing else references the file", async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      {
        findByIdForUser: jest.fn().mockResolvedValue({ storageKey: "stories/some-key.jpg", destroy }),
        delete: jest.fn().mockImplementation((story: { destroy: () => Promise<void> }) => story.destroy()),
      },
      { remove },
    );

    await expect(service.remove("story-1", userId)).resolves.toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith("stories/some-key.jpg");
    expect(destroy).toHaveBeenCalled();
  });

  it("keeps the file when another row still references the same binary", async () => {
    // El nombre del fichero es el SHA-256 del contenido: si otra cuenta subió
    // el mismo binario comparten fichero, y borrar la story ajena le rompía la
    // foto. La fila propia cae igual; el fichero no.
    const destroy = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const service = createService(
      {
        findByIdForUser: jest.fn().mockResolvedValue({ storageKey: "stories/shared-key.jpg", destroy }),
        delete: jest.fn().mockImplementation((story: { destroy: () => Promise<void> }) => story.destroy()),
      },
      { remove },
      true,
    );

    await expect(service.remove("story-1", userId)).resolves.toEqual({ deleted: true });
    expect(destroy).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * Feed: repositorio en memoria que **evalúa de verdad** los fixtures (quién
 * está conectado, qué se vio y cuándo) en vez de devolver una lista ya
 * ordenada por el propio test. Es el mismo enfoque que
 * `stories-purge.service.spec.ts` usa con `findExpired`.
 *
 * Lo que estas pruebas fijan es el contrato entre repositorio, servicio y
 * mapper: que el feed pida `feedForConnections` (y no el viejo `feedForTenant`,
 * que enseñaba el tenant entero) y que el mapper **no** reordene lo que llega.
 * Que el `ORDER BY`/`EXISTS` reales de Postgres produzcan ese orden se verificó
 * ejecutando la consulta contra la base de datos de desarrollo; aquí no hay
 * Postgres porque `yarn test` no debe depender de una base levantada.
 */
interface FeedFixtureStory {
  id: string;
  userId: string;
  fullName: string;
  photoUrl?: string | null;
  /** ISO 8601; el fake lo convierte a `Date`, igual que hace el driver. */
  createdAt: string;
  viewedByMe?: boolean;
}

interface FeedFixture {
  viewerId: string;
  connections: { userId: string; status: ConnectionStatus }[];
  stories: FeedFixtureStory[];
}

function feedRepository(fixture: FeedFixture): Partial<StoriesRepository> {
  const feedForConnections = jest.fn((viewerId: string) => {
    const accepted = new Set(
      fixture.connections
        .filter((connection) => connection.status === ConnectionStatus.ACCEPTED)
        .map((connection) => connection.userId),
    );
    const visible = fixture.stories.filter(
      (story) => story.userId === viewerId || accepted.has(story.userId),
    );

    // Claves de orden por persona, tal como las calculan las funciones de
    // ventana de la consulta real.
    const authorKey = (userId: string) => {
      const own = userId === viewerId ? 1 : 0;
      const mine = visible.filter((story) => story.userId === userId);
      const hasUnviewed = mine.some((story) => story.viewedByMe !== true) ? 1 : 0;
      const latest = Math.max(...mine.map((story) => Date.parse(story.createdAt)));
      return { own, hasUnviewed, latest };
    };

    const rows: StoryFeedRow[] = [...visible]
      .sort((a, b) => {
        const left = authorKey(a.userId);
        const right = authorKey(b.userId);
        return (
          right.own - left.own ||
          right.hasUnviewed - left.hasUnviewed ||
          right.latest - left.latest ||
          a.userId.localeCompare(b.userId) ||
          Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
          a.id.localeCompare(b.id)
        );
      })
      .map((story) => ({
        id: story.id,
        user_id: story.userId,
        full_name: story.fullName,
        photo_url: story.photoUrl ?? null,
        media_url: `http://localhost:3000/media/stories/${story.id}.jpg`,
        media_type: "image" as const,
        caption: null,
        // El driver devuelve `Date` para `timestamptz`: el fake también, o la
        // prueba dejaría de parecerse a producción justo en el campo de D-4.
        created_at: new Date(story.createdAt),
        expires_at: new Date(story.createdAt),
        viewed_by_me: story.viewedByMe === true,
        audience_mode: "ALL_CONNECTIONS",
      }));

    return Promise.resolve(rows);
  });

  return { feedForConnections };
}

describe("StoriesService.feed", () => {
  it("hides the story of somebody the viewer is not connected to", async () => {
    const service = createService(
      feedRepository({
        viewerId,
        connections: [],
        stories: [
          { id: "s-stranger", userId: strangerId, fullName: "Desconocida", createdAt: "2026-09-10T10:00:00.000Z" },
        ],
      }),
    );

    await expect(service.feed(viewerId)).resolves.toEqual([]);
  });

  it("hides the story of a pending connection", async () => {
    const service = createService(
      feedRepository({
        viewerId,
        connections: [{ userId: matchId, status: ConnectionStatus.PENDING }],
        stories: [
          { id: "s-pending", userId: matchId, fullName: "Pendiente", createdAt: "2026-09-10T10:00:00.000Z" },
        ],
      }),
    );

    await expect(service.feed(viewerId)).resolves.toEqual([]);
  });

  it("shows the story of an accepted connection", async () => {
    const service = createService(
      feedRepository({
        viewerId,
        connections: [{ userId: matchId, status: ConnectionStatus.ACCEPTED }],
        stories: [
          { id: "s-match", userId: matchId, fullName: "Match", createdAt: "2026-09-10T10:00:00.000Z" },
        ],
      }),
    );

    const feed = await service.feed(viewerId);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ userId: matchId, fullName: "Match", hasUnviewed: true });
    expect(feed[0].stories.map((story) => story.id)).toEqual(["s-match"]);
  });

  it("puts the viewer's own stories first, even when already seen", async () => {
    const service = createService(
      feedRepository({
        viewerId,
        connections: [{ userId: matchId, status: ConnectionStatus.ACCEPTED }],
        stories: [
          // El match publicó después y tiene contenido sin ver: aun así va detrás.
          { id: "s-match", userId: matchId, fullName: "Match", createdAt: "2026-09-11T09:00:00.000Z" },
          { id: "s-own-2", userId: viewerId, fullName: "Yo", createdAt: "2026-09-10T12:00:00.000Z", viewedByMe: true },
          { id: "s-own-1", userId: viewerId, fullName: "Yo", createdAt: "2026-09-10T08:00:00.000Z", viewedByMe: true },
        ],
      }),
    );

    const feed = await service.feed(viewerId);

    expect(feed.map((entry) => entry.userId)).toEqual([viewerId, matchId]);
    // Dentro de una persona, orden cronológico ascendente: se ven como se publicaron.
    expect(feed[0].stories.map((story) => story.id)).toEqual(["s-own-1", "s-own-2"]);
    expect(feed[0].hasUnviewed).toBe(false);
  });

  it("ranks a match with unseen stories above one already seen in full", async () => {
    const service = createService(
      feedRepository({
        viewerId,
        connections: [
          { userId: matchId, status: ConnectionStatus.ACCEPTED },
          { userId: otherMatchId, status: ConnectionStatus.ACCEPTED },
        ],
        stories: [
          // El ya visto publicó lo más reciente; el sin ver gana igualmente.
          { id: "s-seen", userId: otherMatchId, fullName: "Visto", createdAt: "2026-09-11T11:00:00.000Z", viewedByMe: true },
          { id: "s-unseen", userId: matchId, fullName: "Sin ver", createdAt: "2026-09-11T08:00:00.000Z" },
        ],
      }),
    );

    const feed = await service.feed(viewerId);

    expect(feed.map((entry) => entry.userId)).toEqual([matchId, otherMatchId]);
    expect(feed.map((entry) => entry.hasUnviewed)).toEqual([true, false]);
  });
});

describe("StoriesService.viewers", () => {
  const storyId = "00000000-0000-4000-8000-0000000000f1";

  it("answers 404 for a story the caller does not own", async () => {
    const viewersOf = jest.fn();
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue(null),
      viewersOf,
    });

    await expect(service.viewers(storyId, viewerId, "default")).rejects.toThrow(NotFoundException);
    // Ni siquiera se pregunta por la lista: nada confirma que ese id exista.
    expect(viewersOf).not.toHaveBeenCalled();
  });

  it("answers 404 for an own story that belongs to another tenant", async () => {
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue({ id: storyId, tenantId: "other-gym" }),
      viewersOf: jest.fn(),
    });

    await expect(service.viewers(storyId, viewerId, "default")).rejects.toThrow(NotFoundException);
  });

  it("returns the viewers of an own story, most recent first", async () => {
    const rows = [
      { user_id: matchId, full_name: "Match", photo_url: "http://localhost:3000/media/photos/b.jpg", viewed_at: new Date("2026-09-11T10:00:00.000Z") },
      { user_id: otherMatchId, full_name: "Otro match", photo_url: null, viewed_at: new Date("2026-09-11T08:30:00.000Z") },
    ];
    // El repositorio ya devuelve `viewed_at DESC`; el fake ordena de verdad
    // para que la prueba detecte si el servicio o el mapper alteran el orden.
    const viewersOf = jest.fn(() =>
      Promise.resolve(
        [...rows].sort((a, b) => b.viewed_at.getTime() - a.viewed_at.getTime()),
      ),
    );
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue({ id: storyId, tenantId: "default" }),
      viewersOf,
    });

    await expect(service.viewers(storyId, viewerId, "default")).resolves.toEqual({
      storyId,
      total: 2,
      viewers: [
        {
          userId: matchId,
          fullName: "Match",
          photoUrl: "http://localhost:3000/media/photos/b.jpg",
          viewedAt: "2026-09-11T10:00:00.000Z",
        },
        {
          userId: otherMatchId,
          fullName: "Otro match",
          photoUrl: null,
          viewedAt: "2026-09-11T08:30:00.000Z",
        },
      ],
    });
    expect(viewersOf).toHaveBeenCalledWith(storyId, "default");
  });
});
