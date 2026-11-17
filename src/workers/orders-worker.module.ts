import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BusinessOrdersCoreModule } from "../modules/business-orders/business-orders-core.module";
import { OrdersMaintenanceRunner } from "./orders-maintenance.runner";

@Module({
  imports: [DatabaseModule, BusinessOrdersCoreModule],
  providers: [OrdersMaintenanceRunner],
})
export class OrdersWorkerModule {}
