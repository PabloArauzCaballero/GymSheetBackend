import { Logger, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ResilientThrottlerStorage } from './common/redis/resilient-throttler.storage';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HttpMetricsInterceptor } from './common/metrics/http-metrics.interceptor';
import { OptionalRedisClient, REDIS_CLIENT, RedisModule } from './common/redis/redis.module';
import { env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { AuthModule } from './modules/auth/auth.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { ExportModule } from './modules/export/export.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { HealthModule } from './modules/health/health.module';
import { MembershipModule } from './modules/membership/membership.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { UsersModule } from './modules/users/users.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';

@Module({
  imports: [
    RedisModule,
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
    UsersModule,
    ProfilesModule,
    EquipmentModule,
    FacilitiesModule,
    MembershipModule,
    AccessControlModule,
    NotificationsModule,
    ExercisesModule,
    WorkoutsModule,
    ExportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class AppModule {}
