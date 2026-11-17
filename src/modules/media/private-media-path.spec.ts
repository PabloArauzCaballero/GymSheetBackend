import { isContentAddressedMediaPath, isPrivateStoredMediaPath } from "./private-media-path";

describe("isPrivateStoredMediaPath", () => {
  it.each([
    "/users/a/chats/c/photo.jpg",
    "/users/a/stories/photo.jpg",
    "/users/a/reels/clip.mp4",
    "/users/a/verificaciones/selfie.jpg",
    "/stories/legacy-photo.jpg",
    "/business/1b6f0d1e-0000-4000-8000-000000000001/kyc/2c6f0d1e-0000-4000-8000-000000000002/3d6f0d1e-0000-4000-8000-000000000003.bin",
    "/business/a/kyc",
  ])("blocks private media path %s from static delivery", (path) => {
    expect(isPrivateStoredMediaPath(path)).toBe(true);
  });

  it.each([
    "/users/a/perfiles/photo.jpg",
    "/users/a/publicaciones/post.jpg",
    "/catalog/exercise.jpg",
    "/ejercicios/press/demo.mp4",
    "/business/a/public/logo.png",
  ])("does not change public media path %s", (path) => {
    expect(isPrivateStoredMediaPath(path)).toBe(false);
  });
});

describe("isContentAddressedMediaPath", () => {
  it.each([
    `/srv/media/users/a/perfiles/${"0123456789abcdef".repeat(4)}.jpg`,
    `catalog/${"f".repeat(64)}.webp`,
    `/srv/media/ejercicios/x/${"0".repeat(64)}.mp4`,
  ])("treats %s as immutable", (path) => {
    expect(isContentAddressedMediaPath(path)).toBe(true);
  });

  it.each([
    "/srv/media/catalog/exercise.jpg",
    `/srv/media/${"a".repeat(63)}.jpg`,
    `/srv/media/${"A".repeat(64)}.jpg`,
    `/srv/media/${"a".repeat(64)}`,
    `/srv/media/x${"a".repeat(64)}.jpg`,
  ])("does not treat %s as immutable", (path) => {
    expect(isContentAddressedMediaPath(path)).toBe(false);
  });
});
