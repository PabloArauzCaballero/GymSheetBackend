import { Module } from "@nestjs/common";
import { BrandNameService } from "./brand-name.service";

/** Brand of user-facing emails; needs only the database connection. */
@Module({
  providers: [BrandNameService],
  exports: [BrandNameService],
})
export class BrandingModule {}
