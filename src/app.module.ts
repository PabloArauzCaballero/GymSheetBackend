import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HttpMetricsInterceptor } from './common/metrics/http-metrics.interceptor';
import { env } from './config/env';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './gateway/gateway.module';
import { AuthModule } from './modules/auth/auth.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { ExportModule } from './modules/export/export.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { HealthModule } from './modules/health/health.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { UsersModule } from './modules/users/users.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: env.RATE_LIMIT_TTL_SECONDS * 1000, limit: env.RATE_LIMIT_MAX }]),
    JwtModule.register({
      global: true,
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: env.JWT_ACCESS_EXPIRES_IN, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithm: 'HS256' },
    }),
    DatabaseModule,
    HealthModule,
    GatewayModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    EquipmentModule,
    FacilitiesModule,
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
