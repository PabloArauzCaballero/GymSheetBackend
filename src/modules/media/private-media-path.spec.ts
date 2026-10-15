import { isPrivateStoredMediaPath } from "./private-media-path";

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
