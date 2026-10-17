import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { MediaModule } from '../media/media.module';
import { TrainingModule } from '../training/training.module';
import { CommunityController } from './community.controller';
import { GiphyService } from './giphy.service';
import { CommunityRepository } from './community.repository';
import { CommunityService } from './community.service';
import { ContentCommentModel } from './content-comment.model';
import { ContentRatingModel } from './content-rating.model';

@Module({
  imports: [SequelizeModule.forFeature([ContentRatingModel, ContentCommentModel]), TrainingModule, MediaModule],
  controllers: [CommunityController],
  providers: [CommunityRepository, CommunityService, GiphyService],
})
export class CommunityModule {}
