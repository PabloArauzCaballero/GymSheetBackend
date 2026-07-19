import { Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AccessControlService } from './access-control.service';
import {
  MockAccessEventInput,
  mockAccessEventSchema,
} from './mock-access.schemas';

@Roles(UserRole.ADMIN)
@Controller('admin/access/mock')
export class MockAccessController {
  constructor(private readonly service: AccessControlService) {}

  @Post('events')
  enqueueEvent(
    @Body(new ZodValidationPipe(mockAccessEventSchema))
    input: MockAccessEventInput,
  ) {
    return this.service.enqueueAuthenticatedEvent(input);
  }
}
