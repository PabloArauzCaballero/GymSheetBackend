/** Public static serving must never bypass authorization for private media. */
export function isPrivateStoredMediaPath(decodedPath: string): boolean {
  return /^\/(?:users\/[^/]+\/(?:chats|stories|reels)(?:\/|$)|stories(?:\/|$))/u.test(decodedPath);
}
