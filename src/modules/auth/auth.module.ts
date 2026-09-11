import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { RealtimeModule } from '../../common/realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordResetTokenModel } from './password-reset-token.model';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenModel } from './refresh-token.model';
import { RefreshTokenRepository } from './refresh-token.repository';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    TenantsModule,
    RealtimeModule,
    NotificationsModule,
    SequelizeModule.forFeature([RefreshTokenModel, PasswordResetTokenModel]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RefreshTokenRepository, PasswordResetService],
})
export class AuthModule {}
