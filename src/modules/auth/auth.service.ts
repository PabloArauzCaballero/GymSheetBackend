import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { JwtPayload } from '../../common/types/auth-context.types';
import { UsersRepository } from '../users/users.repository';
import { LoginInput, RegisterInput } from './auth.schemas';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterInput) {
    const existingUser = await this.usersRepository.findByEmail(input.email);

    if (existingUser) {
      throw new ConflictException('Ya existe una cuenta registrada con este correo.');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);
    const user = await this.usersRepository.createCliente({
      email: input.email,
      passwordHash,
      nombreCompleto: input.nombreCompleto,
    });

    return this.buildAuthResponse(user.id, user.email, user.rol, user.nombreCompleto);
  }

  async login(input: LoginInput) {
    const user = await this.usersRepository.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.buildAuthResponse(user.id, user.email, user.rol, user.nombreCompleto);
  }

  private buildAuthResponse(userId: string, email: string, rol: JwtPayload['rol'], nombreCompleto: string) {
    const payload: JwtPayload = { sub: userId, email, rol };
    const accessToken = this.jwtService.sign(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: userId,
        email,
        nombreCompleto,
        rol,
      },
    };
  }
}
