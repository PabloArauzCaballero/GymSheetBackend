import { Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { RoutinePublicationService } from './routine-publication.service';

@Controller('routines')
export class RoutinePublicationController {
  constructor(private readonly publication: RoutinePublicationService) {}

  @Post(':id/publish')
  publish(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.publication.publish(user, id);
  }

  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.publication.unpublish(user, id);
  }

  @Post(':id/copy')
  copy(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.publication.copy(user, id);
  }

  @Post(':id/sync-from-source')
  sync(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.publication.syncFromSource(user, id);
  }
}
