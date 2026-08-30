import { UserStatus } from "../../common/enums/domain.enums";
import { UsersRepository } from "../users/users.repository";
import { ProfileViewsRepository } from "./profile-views.repository";
import { ProfileViewsService } from "./profile-views.service";

const viewerId = "00000000-0000-4000-8000-00000000000a";
const viewedUserId = "00000000-0000-4000-8000-00000000000b";

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

describe("ProfileViewsService.summary", () => {
  it("reports the unique-viewer count from the repository", async () => {
    const service = createService({ countUniqueTodayFor: jest.fn().mockResolvedValue(3) });

    await expect(service.summary(viewedUserId)).resolves.toEqual({ uniqueViewersToday: 3 });
  });
});
