import { BadRequestException } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { UserStatus } from "../../common/enums/domain.enums";
import { ProfileSocialSettingsModel } from "../social/profile-social-settings.model";
import { UsersRepository } from "../users/users.repository";
import { ProfileViewModel } from "./profile-view.model";
import {
  ProfileViewersCursor,
  decodeProfileViewersCursor,
  encodeProfileViewersCursor,
} from "./profile-views.cursor";
import { ProfileViewerRow, ProfileViewsRepository } from "./profile-views.repository";
import { ProfileViewsService } from "./profile-views.service";

const viewerId = "00000000-0000-4000-8000-00000000000a";
const viewedUserId = "00000000-0000-4000-8000-00000000000b";
const otherViewerId = "00000000-0000-4000-8000-00000000000c";

function createService(
  repositoryOverrides: Partial<ProfileViewsRepository>,
  usersOverrides: Partial<UsersRepository> = {},
): ProfileViewsService {
  return new ProfileViewsService(repositoryOverrides as ProfileViewsRepository, {
    findActiveById: jest
      .fn()
      .mockResolvedValue({ id: viewedUserId, tenantId: "default", status: UserStatus.ACTIVE }),
    ...usersOverrides,
  } as unknown as UsersRepository);
}

/** Una fila ya agregada, tal y como la devuelve la consulta de la lista. */
function viewerRow(overrides: Partial<ProfileViewerRow> = {}): ProfileViewerRow {
  return {
    userId: viewerId,
    fullName: "Ana Pérez Soto",
    photoUrl: null,
    objetivo: "HIPERTROFIA",
    branchName: "Sede Centro",
    lastViewedAt: new Date("2026-09-11T10:00:00.000Z"),
    viewCount: 1,
    ...overrides,
  };
}

describe("ProfileViewsService.record", () => {
  it("ignores a self-view without touching the repository", async () => {
    const record = jest.fn();
    const service = createService({ record });

    await service.record(viewerId, "default", viewerId);

    expect(record).not.toHaveBeenCalled();
  });

  it("ignores a view of a nonexistent or inactive account", async () => {
    const record = jest.fn();
    const service = createService({ record }, { findActiveById: jest.fn().mockResolvedValue(null) });

    await service.record(viewerId, "default", viewedUserId);

    expect(record).not.toHaveBeenCalled();
  });

  it("ignores a view across tenants", async () => {
    const record = jest.fn();
    const service = createService(
      { record },
      { findActiveById: jest.fn().mockResolvedValue({ id: viewedUserId, tenantId: "other-gym", status: UserStatus.ACTIVE }) },
    );

    await service.record(viewerId, "default", viewedUserId);

    expect(record).not.toHaveBeenCalled();
  });

  it("records a same-tenant view of another active user", async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const service = createService({ record });

    await service.record(viewerId, "default", viewedUserId);

    expect(record).toHaveBeenCalledWith(viewerId, viewedUserId, "default");
  });
});

describe("ProfileViewsService.listViewers", () => {
  it("returns one row per viewer with the visit count, not one row per visit", async () => {
    const listViewers = jest
      .fn()
      .mockResolvedValue([viewerRow({ viewCount: 5 }), viewerRow({ userId: otherViewerId, fullName: "Luis", viewCount: 1 })]);
    const service = createService({ listViewers, findCheckedAt: jest.fn().mockResolvedValue(null) });

    const page = await service.listViewers(viewedUserId, "default", { limit: 20 });

    expect(page.viewers).toHaveLength(2);
    expect(page.viewers[0]).toMatchObject({ userId: viewerId, viewCount: 5, displayName: "Ana P." });
    // Sin apellido no se inventa inicial.
    expect(page.viewers[1]).toMatchObject({ userId: otherViewerId, displayName: "Luis" });
  });

  it("shortens the name with the directory's rule, second token included", async () => {
    // Paridad con `SocialRepository.directory()`: la regla toma el segundo
    // token sea segundo nombre o apellido. Si allí cambia, esto se rompe.
    const service = createService({
      listViewers: jest.fn().mockResolvedValue([viewerRow({ fullName: "Ana María Pérez Soto" })]),
      findCheckedAt: jest.fn().mockResolvedValue(null),
    });

    const page = await service.listViewers(viewedUserId, "default", { limit: 20 });

    expect(page.viewers[0]?.displayName).toBe("Ana M.");
  });

  it("marks every visit as new when the list was never checked", async () => {
    const service = createService({
      listViewers: jest.fn().mockResolvedValue([viewerRow()]),
      findCheckedAt: jest.fn().mockResolvedValue(null),
    });

    const page = await service.listViewers(viewedUserId, "default", { limit: 20 });

    expect(page.viewers[0]?.isNew).toBe(true);
  });

  it("marks a visit older than the last check as not new, and a later one as new", async () => {
    const service = createService({
      listViewers: jest.fn().mockResolvedValue([
        viewerRow({ userId: otherViewerId, lastViewedAt: new Date("2026-09-11T12:00:00.000Z") }),
        viewerRow({ lastViewedAt: new Date("2026-09-11T08:00:00.000Z") }),
      ]),
      findCheckedAt: jest.fn().mockResolvedValue(new Date("2026-09-11T10:00:00.000Z")),
    });

    const page = await service.listViewers(viewedUserId, "default", { limit: 20 });

    expect(page.viewers.map((viewer) => viewer.isNew)).toEqual([true, false]);
  });

  it("asks for one row more than the limit and emits a cursor only when it comes back", async () => {
    const rows = [
      viewerRow({ lastViewedAt: new Date("2026-09-11T12:00:00.000Z") }),
      viewerRow({ userId: otherViewerId, lastViewedAt: new Date("2026-09-11T11:00:00.000Z") }),
    ];
    const listViewers = jest.fn().mockResolvedValue(rows);
    const service = createService({ listViewers, findCheckedAt: jest.fn().mockResolvedValue(null) });

    const page = await service.listViewers(viewedUserId, "default", { limit: 1 });

    expect(listViewers).toHaveBeenCalledWith(viewedUserId, "default", expect.any(String), {
      limit: 2,
      cursor: null,
    });
    // La fila sobrante no se devuelve: solo delata que hay más.
    expect(page.viewers).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeProfileViewersCursor(page.nextCursor as string)).toEqual({
      lastViewedAt: new Date("2026-09-11T12:00:00.000Z"),
      userId: viewerId,
    });
  });

  it("closes the pagination with a null cursor when the page is the last one", async () => {
    const service = createService({
      listViewers: jest.fn().mockResolvedValue([viewerRow()]),
      findCheckedAt: jest.fn().mockResolvedValue(null),
    });

    const page = await service.listViewers(viewedUserId, "default", { limit: 20 });

    expect(page.nextCursor).toBeNull();
  });

  it("forwards a well-formed cursor to the repository as a decoded keyset", async () => {
    const listViewers = jest.fn().mockResolvedValue([]);
    const service = createService({ listViewers, findCheckedAt: jest.fn().mockResolvedValue(null) });
    const cursor: ProfileViewersCursor = {
      lastViewedAt: new Date("2026-09-11T12:00:00.000Z"),
      userId: viewerId,
    };

    await service.listViewers(viewedUserId, "default", {
      limit: 20,
      cursor: encodeProfileViewersCursor(cursor),
    });

    expect(listViewers).toHaveBeenCalledWith(viewedUserId, "default", expect.any(String), {
      limit: 21,
      cursor,
    });
  });

  describe("hostile cursors", () => {
    const base64url = (payload: unknown): string =>
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

    const cases: Record<string, string> = {
      "not base64 at all": "no-es-un-cursor!!",
      "base64 of something that is not JSON": Buffer.from("hola", "utf8").toString("base64url"),
      "JSON that is not an object": base64url("cadena"),
      "unknown cursor version": base64url({ v: 99, t: "2026-09-11T12:00:00.000Z", u: viewerId }),
      "a viewer id that is not a uuid": base64url({ v: 1, t: "2026-09-11T12:00:00.000Z", u: "'; DROP TABLE profile.profile_views; --" }),
      "a date that is not a date": base64url({ v: 1, t: "ayer por la tarde", u: viewerId }),
      "an impossible date": base64url({ v: 1, t: "2026-13-45T99:00:00.000Z", u: viewerId }),
      "an oversized payload": "A".repeat(5000),
    };

    it.each(Object.entries(cases))(
      "answers 400 (not 500) for %s, without reaching the database",
      async (_name, cursor) => {
        const listViewers = jest.fn();
        const service = createService({ listViewers, findCheckedAt: jest.fn() });

        await expect(
          service.listViewers(viewedUserId, "default", { limit: 20, cursor }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(listViewers).not.toHaveBeenCalled();
      },
    );
  });
});

describe("ProfileViewsService.summary", () => {
  it("reports the three counters from the repository", async () => {
    const summaryFor = jest
      .fn()
      .mockResolvedValue({ uniqueViewersToday: 3, totalUnique: 12, newSinceLastCheck: 4 });
    const service = createService({ summaryFor });

    await expect(service.summary(viewedUserId, "default")).resolves.toEqual({
      uniqueViewersToday: 3,
      totalUnique: 12,
      newSinceLastCheck: 4,
    });
    expect(summaryFor).toHaveBeenCalledWith(viewedUserId, "default", expect.any(String));
  });
});

describe("ProfileViewsService.markChecked", () => {
  it("marks the list as checked for the caller and confirms it", async () => {
    const markChecked = jest.fn().mockResolvedValue(undefined);
    const service = createService({ markChecked });

    await expect(service.markChecked(viewedUserId)).resolves.toEqual({ checked: true });
    expect(markChecked).toHaveBeenCalledWith(viewedUserId);
  });
});

describe("ProfileViewsRepository.markChecked", () => {
  /**
   * Se inspecciona el SQL porque lo que hay que demostrar es justo lo que una
   * consulta contra un doble de la base no enseñaría: que la sentencia inserta
   * la fila de ajustes cuando no existe (`INSERT ... ON CONFLICT DO UPDATE`) en
   * vez de un `UPDATE` que no afectaría a ninguna fila, y que el `DO UPDATE`
   * se mantiene acotado a las dos columnas de esta operación. Que no toque
   * `visible` no es una carencia del ORM que se esquiva —`Model.upsert`
   * tampoco lo pisa—, es el límite que esta sentencia fija por escrito: la
   * fila guarda la visibilidad social de la persona y nadie debe moverla
   * desde aquí.
   */
  function createRepository(): { repository: ProfileViewsRepository; query: jest.Mock } {
    const query = jest.fn().mockResolvedValue([[], 0]);
    const repository = new ProfileViewsRepository(
      { query } as unknown as Sequelize,
      {} as typeof ProfileViewModel,
      {} as typeof ProfileSocialSettingsModel,
    );
    return { repository, query };
  }

  it("creates the settings row when the user never had one", async () => {
    const { repository, query } = createRepository();

    await repository.markChecked(viewedUserId);

    const [sql, options] = query.mock.calls[0] as [string, { replacements: Record<string, unknown>; type: string }];
    expect(sql).toContain("INSERT INTO social.profile_settings");
    expect(sql).toContain("ON CONFLICT (user_id) DO UPDATE");
    expect(sql).toContain("SET profile_views_checked_at = now()");
    expect(sql).not.toMatch(/DO UPDATE[\s\S]*visible/);
    expect(options.type).toBe(QueryTypes.INSERT);
    // Parametrizado: el id viaja como replacement, nunca concatenado en el SQL.
    expect(options.replacements).toEqual({ userId: viewedUserId });
    expect(sql).not.toContain(viewedUserId);
  });
});
