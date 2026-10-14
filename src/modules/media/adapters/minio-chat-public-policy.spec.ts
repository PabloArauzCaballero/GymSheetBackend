import { readFileSync } from "fs";
import { resolve } from "path";
import {
  hasChatMediaPublicPolicyOverlap,
  MINIO_PUBLIC_OBJECT_PATTERNS,
} from "./minio-public-policy";

interface Statement {
  Effect: string;
  Action: string[];
  Resource: string[];
}
function matches(pattern: string, value: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${expression}$`, "s").test(value);
}

// Exercise the actual bootstrap policy against historical object paths, including
// old versions. This is a local policy check, not proof of the deployed ACL.
describe("MinIO bootstrap anonymous policy", () => {
  const compose = readFileSync(
    resolve(__dirname, "../../../../docker-compose.coolify.yml"),
    "utf8",
  );
  const policyJson = compose.match(
    /cat > \/tmp\/bucket-policy\.json <<JSON\n([\s\S]*?)\n\s*JSON/,
  )?.[1];
  const policy = JSON.parse(
    policyJson!.replace(/\$\$MINIO_BUCKET/g, "test-bucket"),
  ) as { Statement: Statement[] };
  function allows(key: string, action: string) {
    return policy.Statement.some(
      (s) =>
        s.Effect === "Allow" &&
        s.Action.some((a) => matches(a, action)) &&
        s.Resource.some((r) => matches(r, `arn:aws:s3:::test-bucket/${key}`)),
    );
  }

  it.each(["s3:GetObject", "s3:GetObjectVersion"])(
    "denies anonymous %s for historical and migrated chat and story objects",
    (action) => {
      for (const key of [
        "users/a/chats/c/old-photo.jpg",
        "users/a/chats/c/migrated-v1/cipher.jpg",
        "users/b/chats/old-conversation/video.mp4",
        "users/a/stories/old-story.jpg",
        "users/b/stories/private-video.mp4",
      ]) {
        expect(allows(key, action)).toBe(false);
      }
    },
  );

  it("keeps the migration classifier synchronized with every public object-read pattern", () => {
    const patterns = policy.Statement.filter(
      (s) =>
        s.Effect === "Allow" &&
        s.Action.some(
          (a) =>
            matches(a, "s3:GetObject") || matches(a, "s3:GetObjectVersion"),
        ),
    ).flatMap((s) =>
      s.Resource.map((r) => r.replace("arn:aws:s3:::test-bucket/", "")),
    );
    expect([...new Set(patterns)].sort()).toEqual(
      [...MINIO_PUBLIC_OBJECT_PATTERNS].sort(),
    );
  });

  it.each(["perfiles", "publicaciones"])(
    "classifies nested %s chat keys as public-policy-overlap instead of safe",
    (category) => {
      const key = `users/a/chats/c/${category}/old.jpg`;
      // This Allow remains in the policy: classify and block migration, do not
      // claim that removing the chats grant denies every noncanonical key.
      expect(allows(key, "s3:GetObject")).toBe(true);
      expect(hasChatMediaPublicPolicyOverlap(key)).toBe(true);
      expect(
        hasChatMediaPublicPolicyOverlap(`users/a/chats/${category}/old.jpg`),
      ).toBe(true);
      expect(
        hasChatMediaPublicPolicyOverlap(`users/a/${category}/old.jpg`),
      ).toBe(false);
      expect(hasChatMediaPublicPolicyOverlap("users/a/chats/c/old.jpg")).toBe(
        false,
      );
    },
  );

  it("treats line breaks in noncanonical S3 keys as part of the wildcard", () => {
    expect(
      hasChatMediaPublicPolicyOverlap("users/a/chats/c/\n/perfiles/old.jpg"),
    ).toBe(true);
  });

  it("preserves anonymous access to the existing public profile and exercise prefixes", () => {
    expect(allows("users/a/perfiles/photo.jpg", "s3:GetObject")).toBe(true);
    expect(allows("ejercicios/press/demo.mp4", "s3:GetObject")).toBe(true);
  });

  it("keeps reel objects outside the anonymous MinIO object-read allowlist", () => {
    expect(allows("users/a/reels/clip.mp4", "s3:GetObject")).toBe(false);
    expect(allows("users/a/reels/clip.mp4", "s3:GetObjectVersion")).toBe(false);
  });

  it("removes anonymous access to story media while retaining the private API path", () => {
    expect(allows("users/a/stories/old-story.jpg", "s3:GetObject")).toBe(false);
    expect(allows("users/a/stories/old-story.jpg", "s3:GetObjectVersion")).toBe(false);
  });
});
