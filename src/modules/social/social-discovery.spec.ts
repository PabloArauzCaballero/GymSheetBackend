import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { UsersRepository } from "../users/users.repository";
import type { DirectoryFilters, DirectoryRow, LastSwipeRow } from "./social.repository";
import { SocialRepository } from "./social.repository";
import { SocialService } from "./social.service";
import type { DiscoveryDeckQuery } from "./social.schemas";

const viewer = "00000000-0000-4000-8000-00000000000a";
const candidate = "00000000-0000-4000-8000-00000000000b";
const other = "00000000-0000-4000-8000-00000000000c";
const stranger = "00000000-0000-4000-8000-00000000000d";

const HOME_GYM = "gimnasio-a";
const OTHER_GYM = "gimnasio-b";

interface FakeMember {
  id: string;
  fullName: string;
  tenantId: string;
}

interface FakeConnection {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: ConnectionStatus;
  createdAt: Date;
  respondedAt: Date | null;
  destroy: () => Promise<void>;
}

interface FakePass {
  viewerId: string;
  targetId: string;
  createdAt: Date;
}

/**
 * Doble en memoria del repositorio social.
 *
 * Es un *fake* y no una pila de `jest.fn()` a propósito: lo que hay que
 * comprobar de la baraja es qué candidatos salen y cuáles no, y eso no se ve
 * afirmando que un mock recibió `excludeDecided: true`. Reproduce las mismas
 * reglas que el SQL: fuera uno mismo, fuera otro gimnasio y, en modo baraja,
 * fuera quien ya tiene conexión o fue descartado.
 */
function createFakeRepository(members: readonly FakeMember[]) {
  const connections: FakeConnection[] = [];
  const passes: FakePass[] = [];
  const state = { conversationHasMessages: false };

  // Reloj monótono: los tests necesitan un orden de swipes inequívoco, y dos
  // llamadas seguidas a `new Date()` pueden devolver el mismo milisegundo.
  let tick = 0;
  const now = (): Date => new Date(Date.UTC(2026, 8, 2, 0, 0, 0) + ++tick * 1000);

  function removeConnection(id: string): void {
    const index = connections.findIndex((row) => row.id === id);
    if (index >= 0) connections.splice(index, 1);
  }

  function makeConnection(requesterId: string, addresseeId: string): FakeConnection {
    const row: FakeConnection = {
      id: `conn-${connections.length + 1}`,
      requesterId,
      addresseeId,
      status: ConnectionStatus.PENDING,
      createdAt: now(),
      respondedAt: null,
      destroy: () => {
        removeConnection(row.id);
        return Promise.resolve();
      },
    };
    return row;
  }

  const repository = {
    runInTransaction: <T>(work: (transaction: never) => Promise<T>): Promise<T> =>
      work(undefined as never),

    findActiveBetween: (userA: string, userB: string) =>
      Promise.resolve(
        connections.find(
          (row) =>
            row.status !== ConnectionStatus.REJECTED &&
            ((row.requesterId === userA && row.addresseeId === userB) ||
              (row.requesterId === userB && row.addresseeId === userA)),
        ) ?? null,
      ),

    create: (requesterId: string, addresseeId: string) => {
      const row = makeConnection(requesterId, addresseeId);
      connections.push(row);
      return Promise.resolve(row);
    },

    findByIdForUser: (id: string, userId: string) =>
      Promise.resolve(
        connections.find(
          (row) => row.id === id && (row.requesterId === userId || row.addresseeId === userId),
        ) ?? null,
      ),

    respond: (connection: FakeConnection, status: ConnectionStatus) => {
      connection.status = status;
      connection.respondedAt = now();
      return Promise.resolve(connection);
    },

    revertToPending: (connection: FakeConnection) => {
      connection.status = ConnectionStatus.PENDING;
      connection.respondedAt = null;
      return Promise.resolve(connection);
    },

    createPass: (viewerId: string, targetId: string) => {
      const already = passes.some(
        (row) => row.viewerId === viewerId && row.targetId === targetId,
      );
      if (!already) passes.push({ viewerId, targetId, createdAt: now() });
      return Promise.resolve();
    },

    deletePass: (viewerId: string, targetId: string) => {
      const index = passes.findIndex(
        (row) => row.viewerId === viewerId && row.targetId === targetId,
      );
      if (index >= 0) passes.splice(index, 1);
      return Promise.resolve(index >= 0 ? 1 : 0);
    },

    /** Misma unión que el SQL de `findLastSwipe`, resuelta en memoria. */
    findLastSwipe: (viewerId: string) => {
      const candidates: LastSwipeRow[] = [];
      for (const row of connections) {
        if (row.requesterId === viewerId && row.status !== ConnectionStatus.REJECTED) {
          candidates.push({
            kind: "LIKE_SENT",
            targetId: row.addresseeId,
            connectionId: row.id,
            connectionStatus: row.status,
            decidedAt: row.createdAt,
          });
        }
        if (
          row.addresseeId === viewerId &&
          row.status === ConnectionStatus.ACCEPTED &&
          row.respondedAt
        ) {
          candidates.push({
            kind: "LIKE_ACCEPTED",
            targetId: row.requesterId,
            connectionId: row.id,
            connectionStatus: row.status,
            decidedAt: row.respondedAt,
          });
        }
      }
      for (const row of passes.filter((pass) => pass.viewerId === viewerId)) {
        candidates.push({
          kind: "PASS",
          targetId: row.targetId,
          connectionId: null,
          connectionStatus: null,
          decidedAt: row.createdAt,
        });
      }
      candidates.sort((left, right) => right.decidedAt.getTime() - left.decidedAt.getTime());
      return Promise.resolve(candidates[0] ?? null);
    },

    directConversationHasMessages: () => Promise.resolve(state.conversationHasMessages),

    listEarnedBadges: () => Promise.resolve([]),

    directory: (viewerId: string, tenantId: string, _default: string, filters: DirectoryFilters) => {
      const rows = members
        .filter((member) => member.id !== viewerId && member.tenantId === tenantId)
        .filter((member) => !filters.targetUserId || member.id === filters.targetUserId)
        .filter((member) => {
          if (!filters.excludeDecided) return true;
          const decided =
            connections.some(
              (row) =>
                (row.requesterId === member.id && row.addresseeId === viewerId) ||
                (row.addresseeId === member.id && row.requesterId === viewerId),
            ) ||
            passes.some((row) => row.viewerId === viewerId && row.targetId === member.id);
          return !decided;
        })
        .slice(0, filters.limit)
        .map(
          (member): DirectoryRow => ({
            userId: member.id,
            fullName: member.fullName,
            objetivo: null,
            branchId: null,
            branchName: null,
            connectionStatus: "NONE",
            connectionId: null,
            socialStatus: null,
            photoUrl: null,
            photos: [],
            age: null,
            gender: null,
            experienceLevel: null,
            points: null,
            levelCode: null,
          }),
        );
      return Promise.resolve(rows);
    },
  };

  return { repository, connections, passes, state };
}

function createService(members: readonly FakeMember[]) {
  const fake = createFakeRepository(members);
  const usersRepository = {
    findActiveById: (userId: string) =>
      Promise.resolve(members.find((member) => member.id === userId) ?? null),
  } as unknown as UsersRepository;

  const service = new SocialService(
    fake.repository as unknown as SocialRepository,
    usersRepository,
  );
  return { service, ...fake };
}

const GYM: readonly FakeMember[] = [
  { id: viewer, fullName: "Ana Pérez", tenantId: HOME_GYM },
  { id: candidate, fullName: "Beto Ruiz", tenantId: HOME_GYM },
  { id: other, fullName: "Caro Lima", tenantId: HOME_GYM },
  { id: stranger, fullName: "Dani Soto", tenantId: OTHER_GYM },
];

const DECK_QUERY: DiscoveryDeckQuery = { limit: 10 };

async function deckIds(service: SocialService): Promise<string[]> {
  const deck = await service.discoveryDeck(viewer, HOME_GYM, DECK_QUERY);
  return deck.map((entry) => entry.userId);
}

describe("SocialService.swipe", () => {
  it("turns a plain like into a pending connection request", async () => {
    const { service, connections } = createService(GYM);

    const result = await service.swipe(viewer, HOME_GYM, {
      targetId: candidate,
      direction: "LIKE",
    });

    expect(result).toMatchObject({ direction: "LIKE", targetId: candidate, matched: false });
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      requesterId: viewer,
      addresseeId: candidate,
      status: ConnectionStatus.PENDING,
    });
  });

  it("reports a match and leaves the connection accepted when the like is mutual", async () => {
    const { service, connections } = createService(GYM);
    // El otro ya deslizó primero: su «me gusta» es la solicitud pendiente.
    await service.swipe(candidate, HOME_GYM, { targetId: viewer, direction: "LIKE" });

    const result = await service.swipe(viewer, HOME_GYM, {
      targetId: candidate,
      direction: "LIKE",
    });

    expect(result.matched).toBe(true);
    expect(result.connectionId).toBe(connections[0].id);
    expect(connections).toHaveLength(1);
    expect(connections[0].status).toBe(ConnectionStatus.ACCEPTED);
  });

  it("persists a pass and drops that candidate from the deck", async () => {
    const { service, passes } = createService(GYM);

    const result = await service.swipe(viewer, HOME_GYM, {
      targetId: candidate,
      direction: "PASS",
    });

    expect(result).toMatchObject({ direction: "PASS", matched: false, connectionId: null });
    expect(passes).toEqual([
      expect.objectContaining({ viewerId: viewer, targetId: candidate }),
    ]);
    await expect(deckIds(service)).resolves.toEqual([other]);
  });

  it("keeps a repeated pass idempotent", async () => {
    const { service, passes } = createService(GYM);

    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "PASS" });
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "PASS" });

    expect(passes).toHaveLength(1);
  });

  it("rejects swiping on yourself", async () => {
    const { service } = createService(GYM);

    await expect(
      service.swipe(viewer, HOME_GYM, { targetId: viewer, direction: "LIKE" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("reports a member of another gym as not found instead of forbidden", async () => {
    const { service, connections } = createService(GYM);

    await expect(
      service.swipe(viewer, HOME_GYM, { targetId: stranger, direction: "LIKE" }),
    ).rejects.toThrow(NotFoundException);
    expect(connections).toHaveLength(0);
  });
});

describe("SocialService.discoveryDeck", () => {
  it("excludes yourself, other gyms and anyone already decided", async () => {
    const { service } = createService(GYM);

    // Punto de partida: los dos socios del mismo gimnasio, nunca uno mismo ni
    // el del otro gimnasio.
    await expect(deckIds(service)).resolves.toEqual([candidate, other]);

    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "LIKE" });
    await expect(deckIds(service)).resolves.toEqual([other]);

    await service.swipe(viewer, HOME_GYM, { targetId: other, direction: "PASS" });
    await expect(deckIds(service)).resolves.toEqual([]);
  });

  it("also excludes a connection that was rejected", async () => {
    const { service, connections } = createService(GYM);
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "LIKE" });
    connections[0].status = ConnectionStatus.REJECTED;

    // Un rechazo permite volver a pedir conexión desde el directorio, pero no
    // devuelve la carta a la baraja: sería el mismo «no» cada semana.
    await expect(deckIds(service)).resolves.toEqual([other]);
  });
});

describe("SocialService.undoLastSwipe", () => {
  it("fails when there is nothing to undo", async () => {
    const { service } = createService(GYM);

    await expect(service.undoLastSwipe(viewer)).rejects.toThrow(NotFoundException);
  });

  it("undoes a pass and puts the candidate back in the deck", async () => {
    const { service, passes } = createService(GYM);
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "PASS" });

    const result = await service.undoLastSwipe(viewer);

    expect(result).toEqual({
      undone: "PASS",
      targetId: candidate,
      connectionId: null,
      unmatched: false,
    });
    expect(passes).toHaveLength(0);
    await expect(deckIds(service)).resolves.toEqual([candidate, other]);
  });

  it("undoes a like by withdrawing the request it created", async () => {
    const { service, connections } = createService(GYM);
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "LIKE" });

    const result = await service.undoLastSwipe(viewer);

    expect(result).toMatchObject({ undone: "LIKE", targetId: candidate, unmatched: false });
    expect(connections).toHaveLength(0);
    await expect(deckIds(service)).resolves.toEqual([candidate, other]);
  });

  it("undoes the newest swipe first, not the newest of a single kind", async () => {
    const { service, connections, passes } = createService(GYM);
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "LIKE" });
    await service.swipe(viewer, HOME_GYM, { targetId: other, direction: "PASS" });

    await expect(service.undoLastSwipe(viewer)).resolves.toMatchObject({
      undone: "PASS",
      targetId: other,
    });
    expect(passes).toHaveLength(0);
    expect(connections).toHaveLength(1);

    await expect(service.undoLastSwipe(viewer)).resolves.toMatchObject({
      undone: "LIKE",
      targetId: candidate,
    });
    expect(connections).toHaveLength(0);
  });

  it("undoes a match by returning the other person's request to pending", async () => {
    const { service, connections } = createService(GYM);
    await service.swipe(candidate, HOME_GYM, { targetId: viewer, direction: "LIKE" });
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "LIKE" });

    const result = await service.undoLastSwipe(viewer);

    expect(result).toMatchObject({ undone: "LIKE", targetId: candidate, unmatched: true });
    // La solicitud no era del viewer: se deshace el «sí», no se borra lo que
    // envió la otra persona.
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      requesterId: candidate,
      status: ConnectionStatus.PENDING,
      respondedAt: null,
    });
  });

  it("refuses to undo a match that already has messages", async () => {
    const { service, connections, state } = createService(GYM);
    await service.swipe(candidate, HOME_GYM, { targetId: viewer, direction: "LIKE" });
    await service.swipe(viewer, HOME_GYM, { targetId: candidate, direction: "LIKE" });
    state.conversationHasMessages = true;

    await expect(service.undoLastSwipe(viewer)).rejects.toThrow(ConflictException);
    expect(connections[0].status).toBe(ConnectionStatus.ACCEPTED);
  });
});

describe("SocialService.memberProfile", () => {
  it("reports a member of another gym as not found", async () => {
    const { service } = createService(GYM);

    await expect(service.memberProfile(viewer, HOME_GYM, stranger)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("returns the directory entry plus the badges already earned", async () => {
    const { service } = createService(GYM);

    const profile = await service.memberProfile(viewer, HOME_GYM, candidate);

    expect(profile).toMatchObject({ userId: candidate, displayName: "Beto R.", badges: [] });
  });
});
