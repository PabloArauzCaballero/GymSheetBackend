import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UniqueConstraintError } from 'sequelize';
import { UserRole } from '../../common/enums/domain.enums';
import { JwtPayload } from '../../common/types/auth-context.types';
import { env } from '../../config/env';
import { UsersRepository } from '../users/users.repository';
import { LoginInput, RegisterInput } from './auth.schemas';

export type AuthResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  user: {
    id: string;
    email: string;
    nombreCompleto: string;
    rol: UserRole;
  };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existingUser = await this.usersRepository.findByEmail(input.email);

    if (existingUser) {
      throw new ConflictException('Ya existe una cuenta registrada con este correo.');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);

    try {
      const createdUser = await this.usersRepository.createClient({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
      });

      return this.buildAuthResponse(
        createdUser.id,
        createdUser.email,
        createdUser.role,
        createdUser.fullName,
      );
    } catch (error: unknown) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('Ya existe una cuenta registrada con este correo.');
      }

      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const activeUser = await this.usersRepository.findActiveByEmail(input.email);

    if (!activeUser) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const passwordMatches = await bcrypt.compare(input.password, activeUser.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.buildAuthResponse(
      activeUser.id,
      activeUser.email,
      activeUser.role,
      activeUser.fullName,
    );
  }

  private buildAuthResponse(
    userId: string,
    emailAddress: string,
    role: JwtPayload['role'],
    fullName: string,
  ): AuthResponse {
    const payload: JwtPayload = {
      sub: userId,
      email: emailAddress,
      role,
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithm: 'HS256',
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: userId,
        email: emailAddress,
        nombreCompleto: fullName,
        rol: role,
      },
    };
  }
}
