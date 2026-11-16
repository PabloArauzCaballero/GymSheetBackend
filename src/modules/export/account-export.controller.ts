import { Controller, Get, Header, HttpCode, HttpStatus, Param, Post, StreamableFile } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UuidParamPipe } from "../../common/pipes/uuid-param.pipe";
import { AuthenticatedUser } from "../../common/types/auth-context.types";
import { SkipLegalAcceptance } from "../legal/skip-legal-acceptance.decorator";
import { AccountExportService } from "./account-export.service";

/** Full copy of the session's own data. Exempt from the legal gate, like the other account rights. */
@SkipLegalAcceptance()
@Controller("me/export")
export class AccountExportController {
  constructor(private readonly exports: AccountExportService) {}

  /** 202: the archive is built in the background; poll the status. One request per 24 h. */
  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  request(@CurrentUser() user: AuthenticatedUser) {
    return this.exports.request(user.id);
  }

  @Get(":id")
  status(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) exportId: string) {
    return this.exports.status(user.id, exportId);
  }

  @Get(":id/download")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="gymsheet-mis-datos.json"')
  @Header("Cache-Control", "no-store")
  async download(@CurrentUser() user: AuthenticatedUser, @Param("id", UuidParamPipe) exportId: string) {
    return new StreamableFile(Buffer.from(await this.exports.download(user.id, exportId), "utf8"));
  }
}
