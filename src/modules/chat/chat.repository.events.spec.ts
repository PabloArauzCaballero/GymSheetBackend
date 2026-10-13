import { ChatRepository, TrainingInviteConversationEvent } from "./chat.repository";
import { mapChatHistoryItem } from "./chat.mapper";
import { ConversationParticipantModel } from "./conversation-participant.model";
import { ConversationModel } from "./conversation.model";
import { MessageModel } from "./message.model";

const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000010";
const eventId = "00000000-0000-4000-8000-000000000020";
const createdAt = new Date("2026-10-12T12:00:00.000Z");

describe("ChatRepository training event history", () => {
  function setup(events: TrainingInviteConversationEvent[]) {
    const query = jest.fn().mockResolvedValue(events);
    const messages = {
      findAll: jest.fn().mockResolvedValue([
        { id: messageId, conversationId, createdAt: new Date(createdAt.getTime() + 1000) },
      ]),
    };
    const repository = new ChatRepository(
      { query } as never,
      {} as typeof ConversationModel,
      {} as typeof ConversationParticipantModel,
      messages as unknown as typeof MessageModel,
    );
    return { repository, query, messages };
  }

  it("merges meeting events and messages by timestamp and caps the combined history", async () => {
    const event: TrainingInviteConversationEvent = {
      id: eventId,
      conversationId,
      invitationId: "00000000-0000-4000-8000-000000000002",
      acceptedRevision: 1,
      startsAt: createdAt,
      timeZone: "America/La_Paz",
      placeLabel: "Gimnasio Central",
      createdAt,
    };
    const { repository, query } = setup([event]);

    const history = await repository.listMessages(conversationId, 1);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "message" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FROM chat.conversation_events"),
      expect.objectContaining({
        replacements: expect.objectContaining({ conversationId, limit: 1 }),
      }),
    );
  });

  it("includes a system event in conversation previews", async () => {
    const { repository, query } = setup([]);
    await repository.listConversationsForUser("00000000-0000-4000-8000-000000000003");
    expect(query.mock.calls[0]?.[0]).toContain("FROM chat.conversation_events e");
    expect(query.mock.calls[0]?.[0]).toContain("'Entrenamiento acordado'");
    expect(query.mock.calls[0]?.[0]).toContain("ORDER BY item.created_at DESC, item.id DESC");
  });

  it("maps an event as a system row without inventing a sender", () => {
    const event: TrainingInviteConversationEvent = {
      id: eventId,
      conversationId,
      invitationId: "00000000-0000-4000-8000-000000000002",
      acceptedRevision: 2,
      startsAt: createdAt,
      timeZone: "America/La_Paz",
      placeLabel: "Gimnasio Central",
      createdAt,
    };
    const result = mapChatHistoryItem({ kind: "system", event });

    expect(result).toMatchObject({
      id: eventId,
      conversationId,
      senderId: null,
      type: "system",
      systemEvent: {
        kind: "TRAINING_INVITE_ACCEPTED",
        acceptedRevision: 2,
        placeLabel: "Gimnasio Central",
      },
    });
  });
});
