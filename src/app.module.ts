import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { ExportModule } from './modules/export/export.module';
import { GatewayModule } from './gateway/gateway.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { UsersModule } from './modules/users/users.module';
import { WorkoutsModule } from './modules/workouts/workouts.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { env } from './config/env';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: env.RATE_LIMIT_TTL_SECONDS * 1000,
        limit: env.RATE_LIMIT_MAX,
      },
    ]),
    JwtModule.register({
      global: true,
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
    }),
    DatabaseModule,
    GatewayModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    EquipmentModule,
    ExercisesModule,
    WorkoutsModule,
    ExportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
