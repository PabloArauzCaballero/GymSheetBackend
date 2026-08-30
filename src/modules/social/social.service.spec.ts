import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ConnectionStatus } from "../../common/enums/domain.enums";
import { UsersRepository } from "../users/users.repository";
import { SocialRepository } from "./social.repository";
import { SocialService } from "./social.service";

const userA = "00000000-0000-4000-8000-00000000000a";
const userB = "00000000-0000-4000-8000-00000000000b";
const userC = "00000000-0000-4000-8000-00000000000c";

function createService(
  repositoryOverrides: Partial<SocialRepository>,
  usersOverrides: Partial<UsersRepository> = {},
): SocialService {
  return new SocialService(repositoryOverrides as SocialRepository, {
    findActiveById: jest.fn().mockResolvedValue({ id: userB, fullName: "Otro Socio", tenantId: "default" }),
    findById: jest.fn().mockResolvedValue({ tenantId: null }),
    ...usersOverrides,
  } as unknown as UsersRepository);
}

function fakeConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "conn-1",
    requesterId: userA,
    addresseeId: userB,
    status: ConnectionStatus.PENDING,
    createdAt: new Date("2026-08-25T00:00:00.000Z"),
    update: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  };
}

describe("SocialService.sendConnection", () => {
  it("rejects sending a connection to yourself", async () => {
    const service = createService({});
    await expect(service.sendConnection(userA, "default", userA)).rejects.toThrow(BadRequestException);
  });

  it("creates a pending request when none exists", async () => {
    const create = jest.fn().mockResolvedValue(fakeConnection());
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(null),
      create,
    });

    const result = await service.sendConnection(userA, "default", userB);

    expect(create).toHaveBeenCalledWith(userA, userB);
    expect(result.status).toBe(ConnectionStatus.PENDING);
  });

  it("auto-accepts when the other person already sent a pending request", async () => {
    const existing = fakeConnection({ requesterId: userB, addresseeId: userA });
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(existing),
      respond: jest.fn().mockImplementation((connection: typeof existing, status: ConnectionStatus) => {
        connection.status = status;
        return Promise.resolve(connection);
      }),
    });

    const result = await service.sendConnection(userA, "default", userB);

    expect(result.status).toBe(ConnectionStatus.ACCEPTED);
  });

  it("rejects a second request while one is already pending in the same direction", async () => {
    const existing = fakeConnection({ requesterId: userA, addresseeId: userB });
    const service = createService({ findActiveBetween: jest.fn().mockResolvedValue(existing) });

    await expect(service.sendConnection(userA, "default", userB)).rejects.toThrow(ConflictException);
  });

  it("rejects a request between accounts that are already connected", async () => {
    const existing = fakeConnection({ status: ConnectionStatus.ACCEPTED });
    const service = createService({ findActiveBetween: jest.fn().mockResolvedValue(existing) });

    await expect(service.sendConnection(userA, "default", userB)).rejects.toThrow(ConflictException);
  });

  it("reports a nonexistent addressee as not found", async () => {
    const service = createService(
      { findActiveBetween: jest.fn().mockResolvedValue(null) },
      { findActiveById: jest.fn().mockResolvedValue(null) },
    );
    await expect(service.sendConnection(userA, "default", userC)).rejects.toThrow(NotFoundException);
  });

  it("reports an addressee from a different tenant as not found", async () => {
    const service = createService(
      { findActiveBetween: jest.fn().mockResolvedValue(null) },
      { findActiveById: jest.fn().mockResolvedValue({ id: userB, fullName: "Otro Socio", tenantId: "other-gym" }) },
    );
    await expect(service.sendConnection(userA, "default", userB)).rejects.toThrow(NotFoundException);
  });
});

describe("SocialService.respondConnection", () => {
  it("lets only the addressee accept a pending request", async () => {
    const connection = fakeConnection({ addresseeId: userB, requesterId: userA });
    const service = createService({
      findByIdForUser: jest.fn().mockResolvedValue(connection),
      respond: jest.fn().mockImplementation((conn: typeof connection, status: ConnectionStatus) => {
        conn.status = status;
        return Promise.resolve(conn);
      }),
      namesFor: jest.fn().mockResolvedValue(new Map([[userA, "Quien Pidió"]])),
    });

    const result = await service.respondConnection("conn-1", userB, { action: "ACCEPT" });
    expect(result.status).toBe(ConnectionStatus.ACCEPTED);
  });

  it("does not let the requester respond to their own request", async () => {
    const connection = fakeConnection({ addresseeId: userB, requesterId: userA });
    const service = createService({ findByIdForUser: jest.fn().mockResolvedValue(connection) });

    await expect(
      service.respondConnection("conn-1", userA, { action: "ACCEPT" }),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects responding to a request that was already answered", async () => {
    const connection = fakeConnection({
      addresseeId: userB,
      requesterId: userA,
      status: ConnectionStatus.ACCEPTED,
    });
    const service = createService({ findByIdForUser: jest.fn().mockResolvedValue(connection) });

    await expect(
      service.respondConnection("conn-1", userB, { action: "ACCEPT" }),
    ).rejects.toThrow(ConflictException);
  });
});

describe("SocialService.withdrawConnection", () => {
  it("lets only the requester withdraw their own request", async () => {
    const connection = fakeConnection({ requesterId: userA, addresseeId: userB });
    const service = createService({ findByIdForUser: jest.fn().mockResolvedValue(connection) });

    await expect(service.withdrawConnection("conn-1", userB)).rejects.toThrow(NotFoundException);
    expect(connection.destroy).not.toHaveBeenCalled();
  });
});

describe("SocialService.viewSocialStatus", () => {
  it("hides the status from a non-connection", async () => {
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(null),
    });
    await expect(service.viewSocialStatus(userA, userB)).resolves.toBeNull();
  });

  it("hides the status when the owner marked it not visible", async () => {
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(fakeConnection({ status: ConnectionStatus.ACCEPTED })),
      getSettings: jest.fn().mockResolvedValue({ visible: false, socialStatus: "SINGLE" }),
    });
    await expect(service.viewSocialStatus(userA, userB)).resolves.toBeNull();
  });

  it("shows the status to an accepted connection when marked visible", async () => {
    const service = createService({
      findActiveBetween: jest.fn().mockResolvedValue(fakeConnection({ status: ConnectionStatus.ACCEPTED })),
      getSettings: jest.fn().mockResolvedValue({ visible: true, socialStatus: "SINGLE" }),
    });
    await expect(service.viewSocialStatus(userA, userB)).resolves.toBe("SINGLE");
  });
});
