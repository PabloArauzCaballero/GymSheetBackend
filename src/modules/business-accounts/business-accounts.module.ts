import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AntibotModule } from '../antibot/antibot.module';
import { AuthModule } from '../auth/auth.module';
import { ClosedAccountSanctionsModule } from '../closed-account-sanctions/closed-account-sanctions.module';
import { DirectoryEntityModel } from '../directory/directory-entity.model';
import { DirectoryModule } from '../directory/directory.module';
import { LegalModule } from '../legal/legal.module';
import { MediaModule } from '../media/media.module';
import { SanctionStatusModule } from '../sanction-status/sanction-status.module';
import { UsersModule } from '../users/users.module';
import { BusinessAccountsRepository } from './business-accounts.repository';
import { BusinessAccountsService } from './business-accounts.service';
import { BusinessGalleryService } from './business-gallery.service';
import { BusinessMeController } from './business-me.controller';
import { BusinessSignupController } from './business-signup.controller';
import { BusinessSignupService } from './business-signup.service';
import { HandlesRepository } from './handles.repository';
import { HandlesService } from './handles.service';
import { PublicHandlesController } from './public-handles.controller';

/** Business accounts and the public `@handle` namespace (ADR-0020, franja 8a). */
@Module({
  imports: [
    AuthModule,
    AntibotModule,
    LegalModule,
    UsersModule,
    ClosedAccountSanctionsModule,
    SanctionStatusModule,
    DirectoryModule,
    MediaModule,
    SequelizeModule.forFeature([DirectoryEntityModel]),
  ],
  controllers: [BusinessSignupController, BusinessMeController, PublicHandlesController],
  providers: [BusinessAccountsRepository, BusinessAccountsService, BusinessGalleryService, BusinessSignupService, HandlesRepository, HandlesService],
  // The KYC (ADR-0021) reads the account and moves the listing's handle; listings (ADR-0022) resolve profiles.
  exports: [BusinessAccountsRepository, HandlesRepository, HandlesService],
})
export class BusinessAccountsModule {}
