import { Logger, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ResilientThrottlerStorage } from './common/redis/resilient-throttler.storage';
import { AffiliationsModule } from './modules/affiliations/affiliations.module';
import { GymCommunityModule } from './modules/gym-community/gym-community.module';
import { BusinessAccountsModule } from './modules/business-accounts/business-accounts.module';
import { BusinessKycModule } from './modules/business-kyc/business-kyc.module';
import { BusinessListingsModule } from './modules/business-listings/business-listings.module';
import { BusinessOrdersModule } from './modules/business-orders/business-orders.module';
import { AccountKindGuard } from './common/guards/account-kind.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { EmailVerificationGuard } from './common/guards/email-verification.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HttpMetricsInterceptor } from './common/metrics/http-metrics.interceptor';
import { CounterRegistryModule } from './common/metrics/counter-registry';
import { OptionalRedisClient, REDIS_CLIENT, RedisModule } from './common/redis/redis.module';
import { RealtimeModule } from './common/realtime/realtime.module';
import { env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { AdminAccessModule } from './modules/admin-access/admin-access.module';
import { AntibotModule } from './modules/antibot/antibot.module';
import { AuditInterceptor } from './modules/admin-access/audit.interceptor';
import { PermissionGuard } from './modules/admin-access/permission.guard';
import { AuthModule } from './modules/auth/auth.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { AccountModule } from './modules/account/account.module';
import { ExportModule } from './modules/export/export.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { HealthModule } from './modules/health/health.module';
import { MediaModule } from './modules/media/media.module';
import { MembershipModule } from './modules/membership/membership.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { MusicModule } from './modules/music/music.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { ProfileViewsModule } from './modules/profile-views/profile-views.module';
import { SocialModule } from './modules/social/social.module';
import { ChatModule } from './modules/chat/chat.module';
import { StoriesModule } from './modules/stories/stories.module';
import { ReelsModule } from './modules/reels/reels.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { CommunityModule } from './modules/community/community.module';
import { TrainingModule } from './modules/training/training.module';
import { TrainingInvitationsModule } from './modules/training-invitations/training-invitations.module';
import { ProgressionModule } from './modules/progression/progression.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { VerificationModule } from './modules/verification/verification.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { LegalAcceptanceGuard } from './modules/legal/legal-acceptance.guard';
import { LegalModule } from './modules/legal/legal.module';
import { ConsentsModule } from './modules/consents/consents.module';

@Module({
  imports: [
    RedisModule,
    CounterRegistryModule,
    RealtimeModule,
    /**
     * Rate-limit counters live in Redis when it is configured, so the limit is
     * enforced across every instance. Without Redis each process keeps its own
     * counters and the effective limit multiplies by the instance count; that
     * fallback is acceptable only for single-instance deployments, which is why
     * a warning is emitted and REDIS_REQUIRED exists to forbid it outright.
     */
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redisClient: OptionalRedisClient) => {
        if (!redisClient) {
          Logger.warn(
            {
              event: 'throttler.storage_in_memory',
              detail:
                'Rate limits are per-process. Configure REDIS_URL before running more than one instance.',
            },
            'AppModule',
          );
          return {
            throttlers: [{ ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_MAX }],
          };
        }

        return {
          throttlers: [{ ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_MAX }],
          // Wrapped so a Redis outage degrades to per-process counters instead
          // of failing every request: the throttler guard runs before every
          // handler, so an unhandled storage error is a full API outage.
          storage: new ResilientThrottlerStorage(
            new ThrottlerStorageRedisService(redisClient),
            new ThrottlerStorageService(),
          ),
        };
      },
    }),
    JwtModule.register({
      global: true,
      secret: env.JWT_ACCESS_SECRET,
      signOptions: {
        expiresIn: env.JWT_ACCESS_EXPIRES_IN,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        algorithm: 'HS256',
      },
    }),
    DatabaseModule,
    HealthModule,
    GatewayModule,
    AuthModule,
    AntibotModule,
    LegalModule,
    ConsentsModule,
    UsersModule,
    ProfilesModule,
    EquipmentModule,
    FacilitiesModule,
    MembershipModule,
    ModerationModule,
    AccessControlModule,
    NotificationsModule,
    ExercisesModule,
    WorkoutsModule,
    TrainingModule,
    TrainingInvitationsModule,
    CommunityModule,
    ProgramsModule,
    ProgressionModule,
    ExportModule,
    AccountModule,
    MediaModule,
    SocialModule,
    ChatModule,
    StoriesModule,
    ReelsModule,
    MusicModule,
    ProfileViewsModule,
    AdminAccessModule,
    TenantsModule,
    DirectoryModule,
    BusinessAccountsModule,
    BusinessKycModule,
    BusinessListingsModule,
    BusinessOrdersModule,
    AffiliationsModule,
    GymCommunityModule,
    VerificationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Deny-by-default for business accounts, and business/* for them only (ADR-0020).
    { provide: APP_GUARD, useClass: AccountKindGuard },
    // Right after authentication: an account that has not accepted the current
    // terms/privacy versions gets 428 before any other rule runs.
    { provide: APP_GUARD, useClass: LegalAcceptanceGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Only routes marked @RequiresVerifiedEmail() (the social surface).
    { provide: APP_GUARD, useClass: EmailVerificationGuard },
    // Runs after RolesGuard: only tightens routes that opt in via @RequirePermission().
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    // Solo actua sobre las rutas marcadas con `@Audited()`, y solo cuando el
    // handler respondio correctamente. Va despues de las metricas porque
    // escribe en base de datos: no debe entrar en la medicion de latencia.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
