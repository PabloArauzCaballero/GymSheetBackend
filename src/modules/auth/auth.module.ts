import { BrandingModule } from '../../common/branding/branding.module';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { RealtimeModule } from '../../common/realtime/realtime.module';
import { AntibotModule } from '../antibot/antibot.module';
import { ClosedAccountSanctionsModule } from '../closed-account-sanctions/closed-account-sanctions.module';
import { LegalModule } from '../legal/legal.module';
import { SanctionStatusModule } from '../sanction-status/sanction-status.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthSessionService } from './auth-session.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationPinRepository } from './email-verification-pin.repository';
import { EmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';
import { IdentitySignInController } from './identity-sign-in.controller';
import { IdentitySignInService } from './identity-sign-in.service';
import { IdentitySignupTokenService } from './identity-signup-token.service';
import { IdentityRepository } from './identity.repository';
import { JwtStrategy } from './jwt.strategy';
import { fetchJwksOverHttps, JWKS_FETCHER, OidcTokenVerifier } from './oidc-token-verifier';
import { PasswordResetTokenModel } from './password-reset-token.model';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenModel } from './refresh-token.model';
import { RefreshTokenRepository } from './refresh-token.repository';
import { UserDeviceRepository } from './user-device.repository';
import { UserDeviceService } from './user-device.service';
import { UserDevicesController } from './user-devices.controller';

@Module({
  imports: [
    BrandingModule,
    PassportModule,
    UsersModule,
    LegalModule,
    TenantsModule,
    RealtimeModule,
    NotificationsModule,
    AntibotModule,
    ClosedAccountSanctionsModule,
    SanctionStatusModule,
    SequelizeModule.forFeature([RefreshTokenModel, PasswordResetTokenModel]),
  ],
  controllers: [
    AuthController,
    EmailVerificationController,
    UserDevicesController,
    IdentitySignInController,
  ],
  providers: [
    AuthService,
    AuthSessionService,
    JwtStrategy,
    RefreshTokenRepository,
    PasswordResetService,
    EmailVerificationPinRepository,
    EmailVerificationService,
    UserDeviceRepository,
    UserDeviceService,
    IdentityRepository,
    IdentitySignupTokenService,
    OidcTokenVerifier,
    { provide: JWKS_FETCHER, useValue: fetchJwksOverHttps },
    IdentitySignInService,
  ],
  exports: [EmailVerificationService, IdentityRepository, AuthSessionService, UserDeviceService],
})
export class AuthModule {}
