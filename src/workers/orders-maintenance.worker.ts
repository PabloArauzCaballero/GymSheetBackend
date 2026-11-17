import { OrdersMaintenanceRunner } from "./orders-maintenance.runner";
import { OrdersWorkerModule } from "./orders-worker.module";
import { bootstrapWorker, reportWorkerBootstrapError } from "./worker-bootstrap";

void bootstrapWorker(OrdersWorkerModule, OrdersMaintenanceRunner).catch(reportWorkerBootstrapError);
