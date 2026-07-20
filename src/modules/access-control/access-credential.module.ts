import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { UsersModule } from '../users/users.module';
import {
  AccessCredentialAdminController,
  AccessCredentialSelfController,
} from './access-credential.controller';
import { AccessCredentialModel } from './access-credential.model';
import { AccessCredentialRepository } from './access-credential.repository';
import { AccessCredentialService } from './access-credential.service';

@Module({
  imports: [UsersModule, SequelizeModule.forFeature([AccessCredentialModel])],
  controllers: [
    AccessCredentialSelfController,
    AccessCredentialAdminController,
  ],
  providers: [AccessCredentialRepository, AccessCredentialService],
  exports: [
    AccessCredentialRepository,
    AccessCredentialService,
    SequelizeModule,
  ],
})
export class AccessCredentialModule {}
