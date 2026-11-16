import { readNonce, readTicket, signNonce, signTicket } from "./signed-token";

const secret = "spec-secret-0123456789abcdef0123456789";
const claims = { id: "3f0c8a52-7d1e-4b8a-9c3d-2e1f0a9b8c7d", issuedAt: new Date("2026-11-16T10:00:00.000Z") };

describe("signed tokens", () => {
  it("round-trips a form ticket", () => {
    expect(readTicket(secret, signTicket(secret, claims))).toEqual(claims);
  });

  it("rejects a ticket signed with another secret or with a tampered payload", () => {
    const ticket = signTicket(secret, claims);
    expect(readTicket("another-secret-0123456789abcdef0123", ticket)).toBeNull();
    const [, signature] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ id: claims.id, iat: Date.now() })).toString("base64url");
    expect(readTicket(secret, `${forged}.${signature}`)).toBeNull();
  });

  it("rejects malformed tickets without throwing", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "x".repeat(600)]) expect(readTicket(secret, bad)).toBeNull();
  });

  it("round-trips an attestation nonce in Play Integrity's web-safe base64 alphabet", () => {
    const nonce = signNonce(secret, claims);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,500}$/);
    expect(readNonce(secret, nonce)).toEqual(claims);
  });

  it("never accepts a ticket as a nonce or a nonce as a ticket", () => {
    expect(readNonce(secret, signTicket(secret, claims))).toBeNull();
    expect(readTicket(secret, signNonce(secret, claims))).toBeNull();
  });

  it("rejects a nonce whose bytes were altered", () => {
    const raw = Buffer.from(signNonce(secret, claims), "base64url");
    raw[0] ^= 0xff;
    expect(readNonce(secret, raw.toString("base64url"))).toBeNull();
  });
});
