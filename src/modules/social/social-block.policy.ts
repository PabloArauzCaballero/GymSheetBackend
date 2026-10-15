export type SocialBlockPair = { blockerId: string; blockedId: string };

/** A block is mutual for visibility and access, regardless of who initiated it. */
export function isSocialPairBlocked(userA: string, userB: string, blocks: readonly SocialBlockPair[]): boolean {
  return blocks.some((block) =>
    (block.blockerId === userA && block.blockedId === userB) ||
    (block.blockerId === userB && block.blockedId === userA),
  );
}
