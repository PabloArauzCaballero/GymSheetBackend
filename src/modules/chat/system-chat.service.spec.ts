// El factory crea el objeto en el momento (no depende de una variable externa
// asignada más abajo, que caería en un TDZ una vez jest sube este `jest.mock`
// por encima de los imports). `env` importado abajo apunta al mismo objeto,
// así que mutarlo en cada test es lo que ve `SystemChatService` internamente.
jest.mock("../../config/env", () => ({ env: {} }));

import { env } from "../../config/env";
import { ChatRepository } from "./chat.repository";
import { UsersRepository } from "../users/users.repository";
import { SystemChatService } from "./system-chat.service";

const userA = "00000000-0000-4000-8000-00000000000a";
const corporateUserId = "00000000-0000-4000-8000-0000000000c0";
const adminUserId = "00000000-0000-4000-8000-0000000000ad";

function createService(
  usersOverrides: Partial<UsersRepository> = {},
  chatOverrides: Partial<ChatRepository> = {},
) {
  const usersRepository = {
    findActiveByEmail: jest.fn().mockResolvedValue(null),
    findAdminForTenant: jest.fn().mockResolvedValue(null),
    ...usersOverrides,
  } as unknown as UsersRepository;
  const chatRepository = {
    findDirectConversation: jest.fn().mockResolvedValue(null),
    createSystemConversation: jest.fn().mockResolvedValue("new-conversation"),
    ...chatOverrides,
  } as unknown as ChatRepository;
  return new SystemChatService(usersRepository, chatRepository);
}

describe("SystemChatService.ensureSystemConversations", () => {
  beforeEach(() => {
    delete env.SEED_SYSTEM_CORPORATE_EMAIL;
  });

  it("creates nothing when no corporate account is seeded and no tenant admin exists", async () => {
    const chatRepository = { createSystemConversation: jest.fn() } as unknown as ChatRepository;
    const service = createService({}, chatRepository);

    await service.ensureSystemConversations(userA, "default");

    expect(chatRepository.createSystemConversation).not.toHaveBeenCalled();
  });

  it("creates the corporate conversation when the account is seeded and not already present", async () => {
    env.SEED_SYSTEM_CORPORATE_EMAIL = "corporativo@gymsheet.local";
    const chatRepository = {
      findDirectConversation: jest.fn().mockResolvedValue(null),
      createSystemConversation: jest.fn().mockResolvedValue("conv-corporate"),
    } as unknown as ChatRepository;
    const service = createService(
      { findActiveByEmail: jest.fn().mockResolvedValue({ id: corporateUserId }) },
      chatRepository,
    );

    await service.ensureSystemConversations(userA, "default");

    expect(chatRepository.createSystemConversation).toHaveBeenCalledWith(userA, corporateUserId, "CORPORATE");
  });

  it("creates the tenant-admin conversation when an active admin is resolved for the tenant", async () => {
    const chatRepository = {
      findDirectConversation: jest.fn().mockResolvedValue(null),
      createSystemConversation: jest.fn().mockResolvedValue("conv-admin"),
    } as unknown as ChatRepository;
    const service = createService(
      { findAdminForTenant: jest.fn().mockResolvedValue({ id: adminUserId }) },
      chatRepository,
    );

    await service.ensureSystemConversations(userA, "topfitness");

    expect(chatRepository.createSystemConversation).toHaveBeenCalledWith(userA, adminUserId, "TENANT_ADMIN");
  });

  it("does not create a duplicate when the direct conversation already exists", async () => {
    env.SEED_SYSTEM_CORPORATE_EMAIL = "corporativo@gymsheet.local";
    const chatRepository = {
      findDirectConversation: jest.fn().mockResolvedValue("existing-conversation"),
      createSystemConversation: jest.fn(),
    } as unknown as ChatRepository;
    const service = createService(
      { findActiveByEmail: jest.fn().mockResolvedValue({ id: corporateUserId }) },
      chatRepository,
    );

    await service.ensureSystemConversations(userA, "default");

    expect(chatRepository.createSystemConversation).not.toHaveBeenCalled();
  });

  it("never creates a conversation with the user themself", async () => {
    env.SEED_SYSTEM_CORPORATE_EMAIL = "corporativo@gymsheet.local";
    const chatRepository = { createSystemConversation: jest.fn() } as unknown as ChatRepository;
    const service = createService(
      { findActiveByEmail: jest.fn().mockResolvedValue({ id: userA }) },
      chatRepository,
    );

    await service.ensureSystemConversations(userA, "default");

    expect(chatRepository.createSystemConversation).not.toHaveBeenCalled();
  });
});
