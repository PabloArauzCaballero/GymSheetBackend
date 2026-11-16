import { HttpException } from "@nestjs/common";
import { KycCipher, kycFingerprint } from "./kyc-cipher";
import { ChatMediaCipher } from "../chat/chat-media-cipher";

const KEY = "k".repeat(40);

describe("KycCipher", () => {
  it("round-trips and the stored bytes never contain the plaintext", () => {
    const cipher = new KycCipher(() => KEY);
    const plain = Buffer.from("CI 1234567 LP — documento de prueba");
    const stored = cipher.encrypt(plain);
    expect(stored.subarray(0, 5).toString("ascii")).toBe("GSKY1");
    expect(stored.includes(plain)).toBe(false);
    expect(stored.includes(Buffer.from("1234567"))).toBe(false);
    expect(cipher.decrypt(stored)).toEqual(plain);
    expect(cipher.decryptText(cipher.encryptText("1020304050"))).toBe("1020304050");
  });

  it("uses a random IV: the same plaintext never encrypts the same twice", () => {
    const cipher = new KycCipher(() => KEY);
    expect(cipher.encrypt(Buffer.from("x")).equals(cipher.encrypt(Buffer.from("x")))).toBe(false);
  });

  it("does not decrypt with another key, and is not interchangeable with the chat cipher", () => {
    const stored = new KycCipher(() => KEY).encrypt(Buffer.from("secret"));
    expect(() => new KycCipher(() => "z".repeat(40)).decrypt(stored)).toThrow();
    expect(() => new ChatMediaCipher(KEY).decrypt(stored)).toThrow();
  });

  it("has no fallback key: without KYC_ENCRYPTION_KEY it answers 503 KYC_UNAVAILABLE", () => {
    const cipher = new KycCipher(() => undefined);
    expect(cipher.available()).toBe(false);
    try {
      cipher.encrypt(Buffer.from("x"));
      throw new Error("expected a refusal");
    } catch (error: unknown) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toMatchObject({ code: "KYC_UNAVAILABLE" });
    }
  });
});

describe("kycFingerprint", () => {
  const pepper = "p".repeat(40);

  it("is a keyed HMAC per kind: the same digits as NIT and as CI never collide", () => {
    expect(kycFingerprint("NIT", "1234567", pepper)).toMatch(/^[0-9a-f]{64}$/u);
    expect(kycFingerprint("NIT", "1234567", pepper)).not.toBe(kycFingerprint("CI", "1234567", pepper));
    expect(kycFingerprint("NIT", "1234567", pepper)).not.toBe(kycFingerprint("NIT", "1234567", "q".repeat(40)));
  });

  it("folds email aliases like the closed-account sanctions do", () => {
    expect(kycFingerprint("EMAIL", "Ana.Perez+kyc@gmail.com", pepper)).toBe(kycFingerprint("EMAIL", "anaperez@googlemail.com", pepper));
  });

  it("refuses to hash without the privacy pepper", () => {
    expect(() => kycFingerprint("CI", "1234567", null)).toThrow(HttpException);
  });
});
