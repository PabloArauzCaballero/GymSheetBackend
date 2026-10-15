import { canViewStory, StoryAudienceFacts } from "./story-audience.policy";

const authorId = "00000000-0000-4000-8000-000000000001";
const selectedId = "00000000-0000-4000-8000-000000000002";
const connectedId = "00000000-0000-4000-8000-000000000003";
const now = new Date("2026-10-10T12:00:00.000Z");

function story(overrides: Partial<StoryAudienceFacts> = {}): StoryAudienceFacts {
  return {
    authorId,
    audienceMode: "ALL_CONNECTIONS",
    expiresAt: new Date("2026-10-10T13:00:00.000Z"),
    hiddenAt: null,
    hasAcceptedConnection: true,
    isSelectedRecipient: false,
    isBlocked: false,
    ...overrides,
  };
}

describe("canViewStory", () => {
  it("keeps legacy stories visible to current accepted connections", () => {
    expect(canViewStory(connectedId, story(), now)).toBe(true);
  });

  it("allows only selected recipients while keeping the accepted-connection check", () => {
    const selected = story({ audienceMode: "SELECTED_CONNECTIONS", isSelectedRecipient: true });
    expect(canViewStory(selectedId, selected, now)).toBe(true);
    expect(canViewStory(connectedId, { ...selected, isSelectedRecipient: false }, now)).toBe(false);
    expect(canViewStory(selectedId, { ...selected, hasAcceptedConnection: false }, now)).toBe(false);
  });

  it("lets the author read their own selected story", () => {
    expect(canViewStory(authorId, story({ audienceMode: "SELECTED_CONNECTIONS" }), now)).toBe(true);
  });

  it("revokes access on block, moderation hide, or expiry", () => {
    expect(canViewStory(connectedId, story({ isBlocked: true }), now)).toBe(false);
    expect(canViewStory(connectedId, story({ hiddenAt: now }), now)).toBe(false);
    expect(canViewStory(connectedId, story({ expiresAt: now }), now)).toBe(false);
  });
});
