/** Public static serving must never bypass authorization for private media. */
export function isPrivateStoredMediaPath(decodedPath: string): boolean {
  return /^\/(?:users\/[^/]+\/(?:chats|stories|reels)(?:\/|$)|stories(?:\/|$))/u.test(decodedPath);
}

/**
 * ¿El fichero se llama por el SHA-256 de su contenido (`<64 hex>.<ext>`)?
 * Es la clave que da `LocalStorageAdapter.upload`: la misma URL nunca cambia de
 * bytes (otro contenido es otra clave), así que se puede cachear como inmutable.
 * Cualquier otro nombre (un fichero puesto a mano, un formato viejo) no.
 */
export function isContentAddressedMediaPath(filePath: string): boolean {
  return /(?:^|[/\\])[0-9a-f]{64}\.[a-z0-9]{2,5}$/u.test(filePath);
}
