import { ConnectionStatus } from "../../common/enums/domain.enums";
import type { Sequelize } from "sequelize-typescript";
import { ConnectionModel } from "./connection.model";
import { DiscoveryPassModel } from "./discovery-pass.model";
import { ProfileSocialSettingsModel } from "./profile-social-settings.model";
import { SocialRepository } from "./social.repository";

const requesterId = "00000000-0000-4000-8000-00000000000a";
const addresseeId = "00000000-0000-4000-8000-00000000000b";

describe("SocialRepository.withdrawConnection", () => {
  function setup(status: ConnectionStatus, requester = requesterId) {
    const transaction = { LOCK: { UPDATE: "UPDATE" } };
    const connection = {
      id: "connection-1",
      status,
      requesterId: requester,
      addresseeId: requester === requesterId ? addresseeId : requesterId,
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    const candidate = { requesterId: connection.requesterId, addresseeId: connection.addresseeId };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(connection);
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "invite-1" }])
      .mockResolvedValue([]);
    const sequelize = {
      transaction: jest.fn((work: (tx: typeof transaction) => Promise<unknown>) => work(transaction)),
      query,
    };
    const repository = new SocialRepository(
      sequelize as unknown as Sequelize,
      { findOne } as unknown as typeof ConnectionModel,
      {} as typeof ProfileSocialSettingsModel,
      {} as typeof DiscoveryPassModel,
    );
    return { repository, query, findOne, connection, transaction };
  }

  it("cancels future accepted and pending invites atomically before deleting an accepted connection", async () => {
    const { repository, query, findOne, connection, transaction } = setup(ConnectionStatus.ACCEPTED);

    await expect(repository.withdrawConnection("connection-1", requesterId)).resolves.toBe(true);

    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne.mock.calls[1]?.[0]).toMatchObject({
      where: { id: "connection-1", requesterId },
      lock: "UPDATE",
      transaction,
    });
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY id FOR UPDATE");
    expect(query.mock.calls[1]?.[0]).toContain("m.starts_at > clock_timestamp()");
    expect(query.mock.calls[1]?.[0]).toContain("m.cancelled_at IS NULL");
    expect(query.mock.calls[2]?.[0]).toContain("state = 'CANCELLED'");
    expect(query.mock.calls[3]?.[0]).toContain("cancelled_at = clock_timestamp()");
    expect(query.mock.calls[4]?.[0]).toContain("UPDATE chat.conversation_events e");
    expect(query.mock.calls[4]?.[0]).toContain("e.cancelled_at IS NULL");
    expect(query.mock.calls[5]?.[0]).toContain("state = 'PENDING'");
    expect(connection.destroy).toHaveBeenCalledWith({ transaction });
  });

  it("does not let the recipient withdraw a request", async () => {
    const { repository, findOne, query, connection } = setup(ConnectionStatus.PENDING);

    await expect(repository.withdrawConnection("connection-1", addresseeId)).resolves.toBe(false);

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(connection.destroy).not.toHaveBeenCalled();
  });
});
