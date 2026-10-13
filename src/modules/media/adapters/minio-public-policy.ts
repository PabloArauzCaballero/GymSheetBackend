/** Keep synchronized with the anonymous object-read resources in the MinIO
 * bootstrap. The policy regression test enforces that correspondence. */
export const MINIO_PUBLIC_OBJECT_PATTERNS: readonly string[] = [
  "users/*/perfiles/*",
  "users/*/publicaciones/*",
  "catalog/*",
  "ejercicios/*",
];

/** S3 resource wildcards span '/', unlike filesystem path globs. */
export function hasChatMediaPublicPolicyOverlap(
  key: string,
  publicObjectPatterns: readonly string[] = MINIO_PUBLIC_OBJECT_PATTERNS,
): boolean {
  if (!/^users\/[^/]+\/chats\//.test(key)) return false;
  return publicObjectPatterns.some((pattern) => {
    const expression = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${expression}$`, "s").test(key);
  });
}
