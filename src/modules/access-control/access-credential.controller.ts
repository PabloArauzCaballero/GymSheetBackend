import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/domain.enums';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthenticatedUser } from '../../common/types/auth-context.types';
import { AccessCredentialService } from './access-credential.service';
import {
  CreateExternalCredentialInput,
  CreatePinCredentialInput,
  RevokeCredentialInput,
  createExternalCredentialSchema,
  createPinCredentialSchema,
  revokeCredentialSchema,
} from './access-credential.schemas';

@Controller('access/credentials')
export class AccessCredentialSelfController {
  constructor(private readonly service: AccessCredentialService) {}

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listByUser(user.id);
  }
}

@Roles(UserRole.ADMIN, UserRole.FRONT_DESK)
@Controller('admin/access/credentials')
export class AccessCredentialAdminController {
  constructor(private readonly service: AccessCredentialService) {}

  @Post('pin')
  createPin(
    @Body(new ZodValidationPipe(createPinCredentialSchema))
    input: CreatePinCredentialInput,
  ) {
    return this.service.createPin(input);
  }

  @Post('external-reference')
  createExternalReference(
    @Body(new ZodValidationPipe(createExternalCredentialSchema))
    input: CreateExternalCredentialInput,
  ) {
    return this.service.createExternalReference(input);
  }

  @Get('user/:userId')
  listForUser(@Param('userId', UuidParamPipe) userId: string) {
    return this.service.listByUser(userId);
  }

  @Patch(':id/revoke')
  revoke(
    @Param('id', UuidParamPipe) id: string,
    @Body(new ZodValidationPipe(revokeCredentialSchema))
    input: RevokeCredentialInput,
  ) {
    return this.service.revoke(id, input);
  }
}
