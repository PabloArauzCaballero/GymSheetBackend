import { isContentAddressedMediaPath, isPrivateStoredMediaPath } from "./private-media-path";

describe("isPrivateStoredMediaPath", () => {
  it.each([
    "/users/a/chats/c/photo.jpg",
    "/users/a/stories/photo.jpg",
    "/users/a/reels/clip.mp4",
    "/stories/legacy-photo.jpg",
  ])("blocks private media path %s from static delivery", (path) => {
    expect(isPrivateStoredMediaPath(path)).toBe(true);
  });

  it.each([
    "/users/a/perfiles/photo.jpg",
    "/users/a/publicaciones/post.jpg",
    "/catalog/exercise.jpg",
    "/ejercicios/press/demo.mp4",
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
