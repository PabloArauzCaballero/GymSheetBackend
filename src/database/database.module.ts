import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { env } from '../config/env';
import { databaseModels } from './models';

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      username: env.DB_USER,
      password: env.DB_PASSWORD,
      models: databaseModels,
      autoLoadModels: false,
      synchronize: false,
      logging: env.DB_LOGGING ? console.log : false,
      dialectOptions: env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: false } } : undefined,
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
    }),
  ],
  exports: [SequelizeModule],
})
export class DatabaseModule {}
