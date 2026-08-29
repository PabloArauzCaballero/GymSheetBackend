import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { RealtimeModule } from '../../common/realtime/realtime.module';
import { env } from '../../config/env';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevLogPasswordResetNotifier } from './dev-log-password-reset.notifier';
import { JwtStrategy } from './jwt.strategy';
import { NullPasswordResetNotifier } from './null-password-reset.notifier';
import { PASSWORD_RESET_NOTIFIER } from './password-reset-notifier';
import { PasswordResetTokenModel } from './password-reset-token.model';
import { PasswordResetTokenRepository } from './password-reset-token.repository';
import { RefreshTokenModel } from './refresh-token.model';
import { RefreshTokenRepository } from './refresh-token.repository';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    TenantsModule,
    RealtimeModule,
    SequelizeModule.forFeature([RefreshTokenModel, PasswordResetTokenModel]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RefreshTokenRepository,
    PasswordResetTokenRepository,
    DevLogPasswordResetNotifier,
    NullPasswordResetNotifier,
    {
      provide: PASSWORD_RESET_NOTIFIER,
      // No real email provider exists yet (see password-reset-notifier.ts).
      // env.ts already refuses PASSWORD_RESET_DEV_LOG_ENABLED in production,
      // so this factory cannot pick the logging adapter there.
      useFactory: (devLogNotifier: DevLogPasswordResetNotifier, nullNotifier: NullPasswordResetNotifier) =>
        env.PASSWORD_RESET_DEV_LOG_ENABLED ? devLogNotifier : nullNotifier,
      inject: [DevLogPasswordResetNotifier, NullPasswordResetNotifier],
    },
  ],
})
export class AuthModule {}
