import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { MediaReferencesRepository } from "../media/media-references.repository";
import { MediaRetentionService } from "../media/media-retention.service";
import { MediaStorageProvider } from "../media/media-storage.port";
import { StoriesRepository, StoryFeedRow } from "./stories.repository";
import { StoriesService } from "./stories.service";

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
    repositoryOverrides as StoriesRepository,
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

    expect(create).toHaveBeenCalledWith(userId, "default", expect.any(Object), "image");
    expect(result.mediaType).toBe("image");
  });
});

describe("StoriesService.view", () => {
  it("rejects viewing a story that does not exist", async () => {
    const service = createService({ findById: jest.fn().mockResolvedValue(null) });
    await expect(service.view("story-1", userId, "default")).rejects.toThrow(NotFoundException);
  });

  it("rejects viewing a story from a different tenant", async () => {
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "other-gym", userId: matchId }),
    });
    await expect(service.view("story-1", userId, "default")).rejects.toThrow(NotFoundException);
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

    await expect(service.view("story-1", userId, "default")).rejects.toThrow(NotFoundException);
    expect(recordView).not.toHaveBeenCalled();
  });

  it("records the view of a match's story", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const hasAcceptedConnection = jest.fn().mockResolvedValue(true);
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "default", userId: matchId }),
      hasAcceptedConnection,
      recordView,
    });

    await expect(service.view("story-1", userId, "default")).resolves.toEqual({ recorded: true });

    expect(hasAcceptedConnection).toHaveBeenCalledWith(userId, matchId);
    expect(recordView).toHaveBeenCalledWith("story-1", userId);
  });

  it("records the view of an own story without asking about connections", async () => {
    const recordView = jest.fn().mockResolvedValue(undefined);
    const hasAcceptedConnection = jest.fn();
    const service = createService({
      findById: jest.fn().mockResolvedValue({ id: "story-1", tenantId: "default", userId }),
      hasAcceptedConnection,
      recordView,
    });

    await service.view("story-1", userId, "default");

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
  const feedForConnections = jest.fn((viewerId: string, _tenantId: string) => {
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
        // El driver devuelve `Date` para `timestamptz`: el fake también, o la
        // prueba dejaría de parecerse a producción justo en el campo de D-4.
        created_at: new Date(story.createdAt),
        expires_at: new Date(story.createdAt),
        viewed_by_me: story.viewedByMe === true,
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

    await expect(service.feed(viewerId, "default")).resolves.toEqual([]);
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

    await expect(service.feed(viewerId, "default")).resolves.toEqual([]);
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

    const feed = await service.feed(viewerId, "default");

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

    const feed = await service.feed(viewerId, "default");

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

    const feed = await service.feed(viewerId, "default");

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
