"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const throttler_1 = require("@nestjs/throttler");
const auth_module_1 = require("./modules/auth/auth.module");
const database_module_1 = require("./database/database.module");
const equipment_module_1 = require("./modules/equipment/equipment.module");
const exercises_module_1 = require("./modules/exercises/exercises.module");
const export_module_1 = require("./modules/export/export.module");
const gateway_module_1 = require("./gateway/gateway.module");
const profiles_module_1 = require("./modules/profiles/profiles.module");
const users_module_1 = require("./modules/users/users.module");
const workouts_module_1 = require("./modules/workouts/workouts.module");
const jwt_auth_guard_1 = require("./common/guards/jwt-auth.guard");
const roles_guard_1 = require("./common/guards/roles.guard");
const env_1 = require("./config/env");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            throttler_1.ThrottlerModule.forRoot([
                {
                    ttl: env_1.env.RATE_LIMIT_TTL_SECONDS * 1000,
                    limit: env_1.env.RATE_LIMIT_MAX,
                },
            ]),
            jwt_1.JwtModule.register({
                global: true,
                secret: env_1.env.JWT_ACCESS_SECRET,
                signOptions: { expiresIn: env_1.env.JWT_ACCESS_EXPIRES_IN },
            }),
            database_module_1.DatabaseModule,
            gateway_module_1.GatewayModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            profiles_module_1.ProfilesModule,
            equipment_module_1.EquipmentModule,
            exercises_module_1.ExercisesModule,
            workouts_module_1.WorkoutsModule,
            export_module_1.ExportModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
            { provide: core_1.APP_GUARD, useClass: jwt_auth_guard_1.JwtAuthGuard },
            { provide: core_1.APP_GUARD, useClass: roles_guard_1.RolesGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map