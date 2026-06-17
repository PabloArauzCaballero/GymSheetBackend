"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const env_1 = require("../config/env");
const models_1 = require("./models");
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Module)({
        imports: [
            sequelize_1.SequelizeModule.forRoot({
                dialect: 'postgres',
                host: env_1.env.DB_HOST,
                port: env_1.env.DB_PORT,
                database: env_1.env.DB_NAME,
                username: env_1.env.DB_USER,
                password: env_1.env.DB_PASSWORD,
                models: models_1.databaseModels,
                autoLoadModels: false,
                synchronize: false,
                logging: env_1.env.DB_LOGGING ? console.log : false,
                dialectOptions: env_1.env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: false } } : undefined,
                pool: {
                    max: 10,
                    min: 0,
                    acquire: 30000,
                    idle: 10000,
                },
            }),
        ],
        exports: [sequelize_1.SequelizeModule],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map