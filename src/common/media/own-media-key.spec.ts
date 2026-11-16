import { isSafeStorageKey, ownMediaKey } from "./own-media-key";

const base = "https://media.example.test/gymsheet";
const me = "11111111-1111-4111-8111-111111111111";
const victim = "22222222-2222-4222-8222-222222222222";

describe("ownMediaKey", () => {
  it("returns the key of a file in the person's own folder", () => {
    expect(ownMediaKey(`${base}/users/${me}/publicaciones/a.jpg`, me, "publicaciones", base)).toBe(
      `users/${me}/publicaciones/a.jpg`,
    );
  });

  it("refuses a path that climbs into someone else's folder", () => {
    expect(ownMediaKey(`${base}/users/${me}/publicaciones/../../${victim}/publicaciones/b.jpg`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`${base}/users/${me}/../${victim}/publicaciones/b.jpg`, me, "publicaciones", base)).toBeNull();
  });

  it("refuses encoded, empty or dot segments, other folders, other hosts and query strings", () => {
    expect(ownMediaKey(`${base}/users/${me}/publicaciones/%2e%2e/b.jpg`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`${base}/users/${me}/publicaciones//b.jpg`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`${base}/users/${me}/publicaciones/./b.jpg`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`${base}/users/${me}/perfiles/b.jpg`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`https://evil.test/gymsheet/users/${me}/publicaciones/b.jpg`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`${base}/users/${me}/publicaciones/b.jpg?x=1`, me, "publicaciones", base)).toBeNull();
    expect(ownMediaKey(`${base}/users/${me}/publicaciones/`, me, "publicaciones", base)).toBeNull();
  });
});

describe("isSafeStorageKey", () => {
  it("accepts plain keys and rejects traversal or encoded ones", () => {
    expect(isSafeStorageKey(`users/${me}/publicaciones/a.jpg`)).toBe(true);
    expect(isSafeStorageKey(`users/${me}/../${victim}/a.jpg`)).toBe(false);
    expect(isSafeStorageKey("/etc/passwd")).toBe(false);
    expect(isSafeStorageKey(`users/${me}/%2e%2e/a.jpg`)).toBe(false);
    expect(isSafeStorageKey("")).toBe(false);
  });
});
