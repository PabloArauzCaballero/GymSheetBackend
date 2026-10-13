/** Immutable, code-owned IDs. Rendering assets are bundled by clients; no URL is resolved here. */
export const CHAT_STICKER_IDS = ["gym.cheer.v1", "gym.strong.v1"] as const;
export type ChatStickerId = typeof CHAT_STICKER_IDS[number];

export function isChatStickerId(value: string): value is ChatStickerId {
  return CHAT_STICKER_IDS.some(id => id === value);
}
