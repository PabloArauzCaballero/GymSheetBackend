import { NotFoundException } from "@nestjs/common";
import type { Sequelize } from "sequelize-typescript";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { SocialInteractionsService } from "./social-interactions.service";
import type { ConnectionModel } from "./connection.model";
import type { DiscoveryPassModel } from "./discovery-pass.model";
import type { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import type { DirectoryFilters, DirectoryRow, InteractionCountsRow } from "./social.repository";
import { SocialRepository } from "./social.repository";

const viewer = "00000000-0000-4000-8000-00000000000a";
/** Me mandó una solicitud y sigue esperando. */
const admirer = "00000000-0000-4000-8000-00000000000b";
/** Le mandé yo la solicitud. */
const crush = "00000000-0000-4000-8000-00000000000c";
/** Ya somos conexión aceptada. */
const mate = "00000000-0000-4000-8000-00000000000d";
/** Su solicitud fue rechazada. */
const refused = "00000000-0000-4000-8000-00000000000e";
/** Me descartó en la baraja. */
const rejecter = "00000000-0000-4000-8000-00000000000f";
/** Lo descarté yo. */
const discarded = "00000000-0000-4000-8000-000000000010";
/** Mismo dato, otro gimnasio: no debe aparecer en ninguna lista. */
const stranger = "00000000-0000-4000-8000-000000000011";

const HOME_GYM = "gimnasio-a";
const OTHER_GYM = "gimnasio-b";

const LIST_QUERY = { limit: 20 };

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
}

interface FakePass {
  viewerId: string;
  targetId: string;
  createdAt: Date;
}

interface FakeProfileView {
  viewerId: string;
  viewedUserId: string;
  viewedAt: Date;
}

const GYM: readonly FakeMember[] = [
  { id: viewer, fullName: "Ana Pérez", tenantId: HOME_GYM },
  { id: admirer, fullName: "Beto Ruiz", tenantId: HOME_GYM },
  { id: crush, fullName: "Caro Lima", tenantId: HOME_GYM },
  { id: mate, fullName: "Dani Soto", tenantId: HOME_GYM },
  { id: refused, fullName: "Eva Mora", tenantId: HOME_GYM },
  { id: rejecter, fullName: "Fabio Vera", tenantId: HOME_GYM },
  { id: discarded, fullName: "Gina Rojas", tenantId: HOME_GYM },
  { id: stranger, fullName: "Hugo Díaz", tenantId: OTHER_GYM },
];

/** Fechas fijas y separadas: el orden de las listas es parte del contrato. */
function at(minute: number): Date {
  return new Date(Date.UTC(2026, 8, 10, 12, minute, 0));
}

/**
 * Doble en memoria del repositorio social.
 *
 * Igual que en `social-discovery.spec.ts`, es un *fake* y no una pila de
 * `jest.fn()`: lo que hay que comprobar es qué personas salen en cada lista y
 * cuáles no, y eso no se ve afirmando que un mock recibió tal argumento. Cada
 * método reproduce el predicado de su SQL —incluido el filtro de gimnasio de
 * `directory()`, que es lo único que mantiene fuera a quien no es del club—.
 */
function createFakeRepository(options: {
  connections?: FakeConnection[];
  passes?: FakePass[];
  profileViews?: FakeProfileView[];
  profileViewsCheckedAt?: Date | null;
}) {
  const connections = options.connections ?? [];
  const passes = options.passes ?? [];
  const profileViews = options.profileViews ?? [];
  const checkedAt = options.profileViewsCheckedAt ?? null;

  const newest = (left: { createdAt: Date }, right: { createdAt: Date }): number =>
    right.createdAt.getTime() - left.createdAt.getTime();

  /** El equivalente al `JOIN public.usuarios` con estado y tenant de los contadores. */
  const belongsTo = (userId: string, tenantId: string): boolean =>
    GYM.some((member) => member.id === userId && member.tenantId === tenantId);

  const repository = {
    listLikesReceived: (viewerId: string, limit: number) =>
      Promise.resolve(
        connections
          .filter((row) => row.addresseeId === viewerId && row.status === ConnectionStatus.PENDING)
          .sort(newest)
          .slice(0, limit)
          .map((row) => ({
            userId: row.requesterId,
            connectionId: row.id,
            likedAt: row.createdAt,
          })),
      ),

    listLikesSent: (viewerId: string, limit: number) =>
      Promise.resolve(
        connections
          .filter((row) => row.requesterId === viewerId && row.status === ConnectionStatus.PENDING)
          .sort(newest)
          .slice(0, limit)
          .map((row) => ({
            userId: row.addresseeId,
            connectionId: row.id,
            likedAt: row.createdAt,
          })),
      ),

    listPassesReceived: (viewerId: string, limit: number) =>
      Promise.resolve(
        passes
          .filter((row) => row.targetId === viewerId)
          .sort(newest)
          .slice(0, limit)
          .map((row) => ({ userId: row.viewerId, passedAt: row.createdAt })),
      ),

    listPassesSent: (viewerId: string, limit: number) =>
      Promise.resolve(
        passes
          .filter((row) => row.viewerId === viewerId)
          .sort(newest)
          .slice(0, limit)
          .map((row) => ({ userId: row.targetId, passedAt: row.createdAt })),
      ),

    deletePass: (viewerId: string, targetId: string) => {
      const index = passes.findIndex(
        (row) => row.viewerId === viewerId && row.targetId === targetId,
      );
      if (index >= 0) passes.splice(index, 1);
      return Promise.resolve(index >= 0 ? 1 : 0);
    },

    countInteractions: (viewerId: string, tenantId: string): Promise<InteractionCountsRow> =>
      Promise.resolve({
        likesReceived: connections.filter(
          (row) =>
            row.addresseeId === viewerId &&
            row.status === ConnectionStatus.PENDING &&
            belongsTo(row.requesterId, tenantId),
        ).length,
        likesSent: connections.filter(
          (row) =>
            row.requesterId === viewerId &&
            row.status === ConnectionStatus.PENDING &&
            belongsTo(row.addresseeId, tenantId),
        ).length,
        passesReceived: passes.filter(
          (row) => row.targetId === viewerId && belongsTo(row.viewerId, tenantId),
        ).length,
        passesSent: passes.filter(
          (row) => row.viewerId === viewerId && belongsTo(row.targetId, tenantId),
        ).length,
        profileViewsNew: new Set(
          profileViews
            .filter(
              (row) =>
                row.viewedUserId === viewerId &&
                belongsTo(row.viewerId, tenantId) &&
                (!checkedAt || row.viewedAt > checkedAt),
            )
            .map((row) => row.viewerId),
        ).size,
      }),

    directory: (
      viewerId: string,
      tenantId: string,
      _defaultTenantId: string,
      filters: DirectoryFilters,
    ) => {
      if (filters.userIds && filters.userIds.length === 0) return Promise.resolve([]);
      const wanted = filters.userIds ? new Set(filters.userIds) : null;
      const rows = GYM.filter((member) => member.id !== viewerId && member.tenantId === tenantId)
        .filter((member) => !wanted || wanted.has(member.id))
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

  return { repository, connections, passes };
}

function createService(options: Parameters<typeof createFakeRepository>[0] = {}) {
  const fake = createFakeRepository(options);
  const service = new SocialInteractionsService(fake.repository as unknown as SocialRepository);
  return { service, ...fake };
}

/** El escenario completo: cada estado posible representado una vez. */
function fullScenario() {
  return {
    connections: [
      { id: "conn-1", requesterId: admirer, addresseeId: viewer, status: ConnectionStatus.PENDING, createdAt: at(1) },
      { id: "conn-2", requesterId: viewer, addresseeId: crush, status: ConnectionStatus.PENDING, createdAt: at(2) },
      { id: "conn-3", requesterId: mate, addresseeId: viewer, status: ConnectionStatus.ACCEPTED, createdAt: at(3) },
      { id: "conn-4", requesterId: refused, addresseeId: viewer, status: ConnectionStatus.REJECTED, createdAt: at(4) },
      { id: "conn-5", requesterId: stranger, addresseeId: viewer, status: ConnectionStatus.PENDING, createdAt: at(5) },
      { id: "conn-6", requesterId: viewer, addresseeId: stranger, status: ConnectionStatus.PENDING, createdAt: at(6) },
    ],
    passes: [
      { viewerId: rejecter, targetId: viewer, createdAt: at(7) },
      { viewerId: viewer, targetId: discarded, createdAt: at(8) },
      { viewerId: stranger, targetId: viewer, createdAt: at(9) },
      { viewerId: viewer, targetId: stranger, createdAt: at(10) },
    ],
    profileViews: [
      { viewerId: mate, viewedUserId: viewer, viewedAt: at(11) },
      // La misma persona dos veces sigue siendo una persona.
      { viewerId: mate, viewedUserId: viewer, viewedAt: at(12) },
      { viewerId: crush, viewedUserId: viewer, viewedAt: at(13) },
      // Anterior al último vistazo: ya no es nueva.
      { viewerId: admirer, viewedUserId: viewer, viewedAt: at(0) },
      // De otro gimnasio: no cuenta, igual que no aparecería en la lista.
      { viewerId: stranger, viewedUserId: viewer, viewedAt: at(14) },
    ],
    profileViewsCheckedAt: at(1),
  };
}

describe("SocialInteractionsService — quién me dio like", () => {
  it("lista sólo las solicitudes pendientes dirigidas a mí, no las que envié yo", async () => {
    const { service } = createService(fullScenario());

    const received = await service.likesReceived(viewer, HOME_GYM, LIST_QUERY);

    expect(received.map((entry) => entry.userId)).toEqual([admirer]);
    expect(received[0]).toMatchObject({
      connectionId: "conn-1",
      displayName: "Beto R.",
      likedAt: at(1).toISOString(),
      photos: [],
      age: null,
    });
  });

  it("deja fuera las conexiones ya aceptadas y las rechazadas", async () => {
    const { service } = createService(fullScenario());

    const received = await service.likesReceived(viewer, HOME_GYM, LIST_QUERY);

    const ids = received.map((entry) => entry.userId);
    expect(ids).not.toContain(mate);
    expect(ids).not.toContain(refused);
  });

  it("lista en «enviados» sólo las mías que siguen pendientes", async () => {
    const { service } = createService(fullScenario());

    const sent = await service.likesSent(viewer, HOME_GYM, LIST_QUERY);

    expect(sent.map((entry) => entry.userId)).toEqual([crush]);
    expect(sent[0]).toMatchObject({ connectionId: "conn-2", likedAt: at(2).toISOString() });
  });
});

describe("SocialInteractionsService — quién me dio next", () => {
  it("lista a quien me descartó y no a quien descarté yo", async () => {
    const { service } = createService(fullScenario());

    const received = await service.passesReceived(viewer, HOME_GYM, LIST_QUERY);

    expect(received.map((entry) => entry.userId)).toEqual([rejecter]);
    expect(received[0]).toMatchObject({ displayName: "Fabio V.", passedAt: at(7).toISOString() });
  });

  it("lista en «enviados» a quien descarté yo", async () => {
    const { service } = createService(fullScenario());

    const sent = await service.passesSent(viewer, HOME_GYM, LIST_QUERY);

    expect(sent.map((entry) => entry.userId)).toEqual([discarded]);
    expect(sent[0]).toMatchObject({ passedAt: at(8).toISOString() });
  });
});

describe("SocialInteractionsService.deletePass", () => {
  it("borra mi descarte y devuelve a esa persona a la baraja", async () => {
    const { service, passes } = createService(fullScenario());

    await expect(service.deletePass(viewer, discarded)).resolves.toEqual({ deleted: true });
    expect(passes.some((row) => row.viewerId === viewer && row.targetId === discarded)).toBe(false);
    await expect(service.passesSent(viewer, HOME_GYM, LIST_QUERY)).resolves.toEqual([]);
  });

  it("responde 404 cuando no había descarte que borrar", async () => {
    const { service } = createService(fullScenario());

    await expect(service.deletePass(viewer, admirer)).rejects.toThrow(NotFoundException);
  });

  it("no permite borrar el descarte que otra persona hizo sobre mí", async () => {
    const { service, passes } = createService(fullScenario());

    // `rejecter` me descartó: ese pass es suyo, no mío, y desde aquí no se
    // toca. Sólo se borra la pareja (viewer, target) con el viewer del token.
    await expect(service.deletePass(viewer, rejecter)).rejects.toThrow(NotFoundException);
    expect(passes.some((row) => row.viewerId === rejecter && row.targetId === viewer)).toBe(true);
  });
});

describe("SocialInteractionsService — aislamiento por gimnasio", () => {
  it("no muestra a alguien de otro gimnasio en ninguna de las cuatro listas", async () => {
    const { service } = createService(fullScenario());

    const lists = await Promise.all([
      service.likesReceived(viewer, HOME_GYM, LIST_QUERY),
      service.likesSent(viewer, HOME_GYM, LIST_QUERY),
      service.passesReceived(viewer, HOME_GYM, LIST_QUERY),
      service.passesSent(viewer, HOME_GYM, LIST_QUERY),
    ]);

    for (const list of lists) {
      expect(list.map((entry) => entry.userId)).not.toContain(stranger);
    }
    // Y no es que se caiga la lista entera: lo de casa sigue estando.
    expect(lists.map((list) => list.length)).toEqual([1, 1, 1, 1]);
  });
});

describe("SocialInteractionsService.counts", () => {
  it("devuelve los cinco contadores", async () => {
    const { service } = createService(fullScenario());

    await expect(service.counts(viewer, HOME_GYM)).resolves.toEqual({
      likesReceived: 1,
      likesSent: 1,
      passesReceived: 1,
      passesSent: 1,
      // `mate` y `crush`: dos espectadores únicos posteriores al último vistazo.
      profileViewsNew: 2,
    });
  });

  it("cuenta todas las visitas cuando nunca se abrió la lista", async () => {
    const { service } = createService({ ...fullScenario(), profileViewsCheckedAt: null });

    await expect(service.counts(viewer, HOME_GYM)).resolves.toMatchObject({
      profileViewsNew: 3,
    });
  });
});

describe("SocialRepository.directory con userIds", () => {
  function createRepository() {
    const query = jest.fn();
    const repository = new SocialRepository(
      { query } as unknown as Sequelize,
      {} as unknown as typeof ConnectionModel,
      {} as unknown as typeof ProfileSocialSettingsModel,
      {} as unknown as typeof DiscoveryPassModel,
    );
    return { repository, query };
  }

  it("no consulta la base cuando el conjunto de ids está vacío", async () => {
    const { repository, query } = createRepository();

    // Un `IN ()` no es SQL válido: pedir las fichas de una lista vacía tiene
    // que resolverse antes de llegar a Postgres.
    await expect(
      repository.directory(viewer, HOME_GYM, "default", { limit: 0, userIds: [] }),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("sí consulta, y con los ids como parámetro, cuando el conjunto no está vacío", async () => {
    const { repository, query } = createRepository();
    query.mockResolvedValue([]);

    await repository.directory(viewer, HOME_GYM, "default", {
      limit: 2,
      userIds: [admirer, crush],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown> }];
    expect(sql).toContain("u.id IN (:userIds)");
    expect(options.replacements).toMatchObject({
      hasUserIds: true,
      userIds: [admirer, crush],
    });
  });
});
