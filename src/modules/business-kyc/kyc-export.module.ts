import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { KycCipher } from "./kyc-cipher";
import { KycExportReader } from "./kyc-export.reader";

/** The KYC reader of the account export, without the KYC HTTP surface: the account-data worker imports it too. */
@Module({
  imports: [MediaModule],
  providers: [{ provide: KycCipher, useFactory: () => new KycCipher() }, KycExportReader],
  exports: [KycExportReader],
})
export class KycExportModule {}
