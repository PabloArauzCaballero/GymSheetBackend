import { ChatMediaCipher } from "./chat-media-cipher";

describe("ChatMediaCipher", () => {
  it("encrypts bytes before they reach storage and restores them for an authorized read", () => {
    const cipher = new ChatMediaCipher("test-secret-that-is-long-enough-to-derive-a-key");
    const original = Buffer.from("private chat photo bytes");

    const encrypted = cipher.encrypt(original);

    expect(encrypted.equals(original)).toBe(false);
    expect(encrypted.includes(original)).toBe(false);
    expect(cipher.decrypt(encrypted)).toEqual(original);
  });

  it("rejects ciphertext modified after upload", () => {
    const cipher = new ChatMediaCipher("test-secret-that-is-long-enough-to-derive-a-key");
    const encrypted = cipher.encrypt(Buffer.from("private bytes"));
    encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1] ^ 0xff;

    expect(() => cipher.decrypt(encrypted)).toThrow();
  });
});
