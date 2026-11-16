import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Req } from "@nestjs/common";
import { Request } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { clientDeviceContext } from "./client-device-context";
import { UserDeviceService } from "./user-device.service";

@Controller("me/devices")
export class UserDevicesController {
  constructor(private readonly devices: UserDeviceService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.devices.listMine(user.id, clientDeviceContext(request).installationId);
  }

  /** Signs the device out: revokes it and every session bound to it. Foreign id → 404. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(":id")
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) deviceId: string) {
    await this.devices.revokeMine(user.id, deviceId);
  }
}
