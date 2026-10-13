import { ConnectionStatus } from "../../common/enums/domain.enums";
import type { Sequelize } from "sequelize-typescript";
import { ConnectionModel } from "./connection.model";
import { DiscoveryPassModel } from "./discovery-pass.model";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { SocialRepository } from "./social.repository";

const actor = "00000000-0000-4000-8000-00000000000a";
const other = "00000000-0000-4000-8000-00000000000b";

describe("SocialRepository.revokeConnection", () => {
  function setup(status: ConnectionStatus, requesterId = actor) {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const connection = {
      status,
      requesterId,
      addresseeId: requesterId === actor ? other : actor,
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { conversation_id: "chat-1" },
        { conversation_id: "chat-2" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const sequelize = {
      transaction: jest.fn(
        (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
      query,
    };
    const connections = { findOne: jest.fn().mockResolvedValue(connection) };
    const repository = new SocialRepository(
      sequelize as unknown as Sequelize,
      connections as unknown as typeof ConnectionModel,
      {} as typeof ProfileSocialSettingsModel,
      {} as typeof DiscoveryPassModel,
    );
    return { repository, query, connection, connections };
  }

  it("tombstones every direct chat in the same transaction before removing an accepted pair", async () => {
    const { repository, query, connection, connections } = setup(
      ConnectionStatus.ACCEPTED,
    );

    await expect(
      repository.revokeConnection("connection-1", actor),
    ).resolves.toEqual({
      conversationIds: ["chat-1", "chat-2"],
    });

    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY id FOR UPDATE");
    expect(query.mock.calls[1]?.[0]).toContain("FOR UPDATE OF c");
    expect(query.mock.calls[2]?.[0]).toContain("revoked_at = NOW()");
    expect(query.mock.calls[2]?.[1]).toMatchObject({
      replacements: { userId: actor, conversationIds: ["chat-1", "chat-2"] },
    });
    expect(query.mock.calls[3]?.[0]).toContain(
      "training.training_invite_meetings",
    );
    expect(query.mock.calls[3]?.[0]).toContain("FOR UPDATE OF i, m");
    expect(query.mock.calls[4]?.[0]).toContain("state = 'PENDING'");
    expect(query.mock.calls[4]?.[1]).toMatchObject({
      replacements: { requesterId: actor, addresseeId: other },
    });
    expect(connections.findOne).toHaveBeenCalledTimes(2);
    expect(connections.findOne.mock.calls[0]?.[0]).not.toHaveProperty("lock");
    expect(connections.findOne.mock.calls[1]?.[0]).toHaveProperty(
      "lock",
      "UPDATE",
    );
    expect(connection.destroy).toHaveBeenCalled();
  });

  it("cancels accepted future meetings exactly once without deleting their history", async () => {
    const { repository, query, connection } = setup(ConnectionStatus.ACCEPTED);
    query.mockReset();
    query
      .mockResolvedValueOnce([]) // pair lock
      .mockResolvedValueOnce([]) // no direct conversation
      .mockResolvedValueOnce([{ id: "invite-1" }])
      .mockResolvedValueOnce([]) // accepted state update
      .mockResolvedValueOnce([]) // meeting cancelled_at update
      .mockResolvedValueOnce([]); // pending state update

    await repository.revokeConnection("connection-1", actor);

    expect(query.mock.calls[2]?.[0]).toContain("m.starts_at > clock_timestamp()");
    expect(query.mock.calls[3]?.[0]).toContain("state = 'CANCELLED'");
    expect(query.mock.calls[3]?.[1].replacements.inviteIds).toEqual(["invite-1"]);
    expect(query.mock.calls[4]?.[0]).toContain("cancelled_at IS NULL");
    expect(query.mock.calls[5]?.[0]).toContain("state = 'PENDING'");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM training."))).toBe(false);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not let the recipient delete a pending request", async () => {
    const { repository, query, connection } = setup(ConnectionStatus.PENDING);

    await expect(
      repository.revokeConnection("connection-1", other),
    ).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });
});
