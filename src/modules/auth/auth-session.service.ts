import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { Transaction } from "sequelize";
import { UserRole } from "../../common/enums/domain.enums";
import { parseDurationToMs } from "../../common/time/duration.util";
import { AccountKind, JwtPayload, accountKindOf } from "../../common/types/auth-context.types";
import { env } from "../../config/env";
import { RefreshTokenRepository } from "./refresh-token.repository";
import { issueOpaqueToken } from "./token-hash.util";

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  user: {
    id: string;
    email: string;
    nombreCompleto: string;
    rol: UserRole;
    /** Gimnasio de la cuenta; el cliente móvil pinta su marca a partir de esto. */
    tenantId: string | null;
    /** False until the mailbox is proven; social features stay closed until then. */
    emailVerified: boolean;
    /** Person or business (ADR-0020): the client mounts the matching shell. */
    accountKind: AccountKind;
  };
};

/** The account fields a session is built from. */
export type SessionAccount = {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  tenantId: string | null;
  emailVerifiedAt?: Date | null;
};

/** Issues the access token and the refresh token of a session. */
@Injectable()
export class AuthSessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  async issue(
    account: SessionAccount,
    options: { familyId?: string; deviceId?: string | null } = {},
    transaction?: Transaction,
  ): Promise<AuthResponse> {
    const refreshToken = await this.issueRefreshToken(
      account.id,
      options.familyId ?? randomUUID(),
      options.deviceId ?? null,
      transaction,
    );
    return { ...this.buildAccessResponse(account, options.deviceId ?? null), refreshToken };
  }

  private buildAccessResponse(account: SessionAccount, deviceId: string | null): Omit<AuthResponse, "refreshToken"> {
    const payload: JwtPayload = {
      sub: account.id,
      email: account.email,
      role: account.role,
      sat: Date.now(),
      ...(deviceId ? { did: deviceId } : {}),
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithm: "HS256",
    });

    return {
      accessToken,
      tokenType: "Bearer",
      user: {
        id: account.id,
        email: account.email,
        nombreCompleto: account.fullName,
        rol: account.role,
        // Las cuentas creadas antes de existir el campo no tienen gimnasio
        // guardado. Se resuelven aquí contra la instalación en vez de
        // reescribirlas en masa: una migración que asignara marca a treinta
        // cuentas existentes sería una decisión de negocio disfrazada de esquema.
        tenantId: account.tenantId ?? env.DEFAULT_TENANT_ID ?? null,
        emailVerified: Boolean(account.emailVerifiedAt),
        accountKind: accountKindOf(account.role),
      },
    };
  }

  private async issueRefreshToken(
    userId: string,
    familyId: string,
    deviceId: string | null,
    transaction?: Transaction,
  ): Promise<string> {
    const { rawToken, tokenHash } = issueOpaqueToken("refresh");
    const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));
    await this.refreshTokenRepository.create({ userId, familyId, tokenHash, expiresAt, deviceId }, transaction);
    return rawToken;
  }
}
