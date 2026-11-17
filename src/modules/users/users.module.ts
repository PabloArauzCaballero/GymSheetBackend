import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { BranchModel } from '../facilities/branch.model';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersRepository } from './admin-users.repository';
import { AdminUsersService } from './admin-users.service';
import { UserModel } from './user.model';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { UserActivityService } from './user-activity.service';
import { IntegrationModule } from '../integration/integration.module';

@Module({
  imports: [SequelizeModule.forFeature([UserModel, BranchModel]), IntegrationModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersRepository, UsersService, UserActivityService, AdminUsersRepository, AdminUsersService],
  exports: [UsersRepository, UsersService, UserActivityService],
})
export class UsersModule {}
