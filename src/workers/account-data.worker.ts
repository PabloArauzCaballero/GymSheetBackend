import { AccountDataRunner } from "./account-data.runner";
import { AccountDataWorkerModule } from "./account-data-worker.module";
import { bootstrapWorker, reportWorkerBootstrapError } from "./worker-bootstrap";

void bootstrapWorker(AccountDataWorkerModule, AccountDataRunner).catch(reportWorkerBootstrapError);
