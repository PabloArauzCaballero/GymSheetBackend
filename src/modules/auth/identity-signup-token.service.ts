import { HttpStatus, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DomainException } from "../../common/errors/domain.exception";
import { env } from "../../config/env";
import { IdentityProvider } from "./oidc-token-verifier";

const TOKEN_PURPOSE = "identity_signup";
const TOKEN_TTL = "15m";

export type IdentitySignupClaims = { provider: IdentityProvider; subject: string; email: string };

/**
 * Short-lived proof that a provider vouched for `(provider, subject, email)`,
 * carried between "new person" and the profile completion. Its own audience
 * keeps it from ever passing as an access token (the JWT strategy checks
 * `JWT_AUDIENCE`), and `purpose` keeps any other token from passing as it.
 * Single use in effect: completing creates the identity, and a second
 * completion hits the unique `(provider, subject)` key.
 */
@Injectable()
export class IdentitySignupTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issue(claims: IdentitySignupClaims): string {
    return this.jwtService.sign(
      { purpose: TOKEN_PURPOSE, provider: claims.provider, email: claims.email },
      {
        secret: env.JWT_ACCESS_SECRET,
        subject: claims.subject,
        expiresIn: TOKEN_TTL,
        issuer: env.JWT_ISSUER,
        audience: signupAudience(),
        algorithm: "HS256",
      },
    );
  }

  verify(token: string): IdentitySignupClaims {
    let payload: Record<string, unknown>;
    try {
      payload = this.jwtService.verify<Record<string, unknown>>(token, {
        secret: env.JWT_ACCESS_SECRET,
        issuer: env.JWT_ISSUER,
        audience: signupAudience(),
        algorithms: ["HS256"],
      });
    } catch {
      throw invalidSignupToken();
    }
    const { purpose, provider, email, sub } = payload;
    if (
      purpose !== TOKEN_PURPOSE ||
      (provider !== "GOOGLE" && provider !== "APPLE") ||
      typeof email !== "string" ||
      typeof sub !== "string"
    ) {
      throw invalidSignupToken();
    }
    return { provider, subject: sub, email };
  }
}

function signupAudience(): string {
  return `${env.JWT_AUDIENCE}:identity-signup`;
}

function invalidSignupToken(): DomainException {
  return new DomainException(
    HttpStatus.UNAUTHORIZED,
    "SIGNUP_TOKEN_INVALID",
    "Tu sesión de registro caducó. Vuelve a iniciar sesión con tu cuenta.",
  );
}
