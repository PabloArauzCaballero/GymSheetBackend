import { AccessEventRunner } from './access-event.runner';
import { AccessWorkerModule } from './access-worker.module';
import {
  bootstrapWorker,
  reportWorkerBootstrapError,
} from './worker-bootstrap';

void bootstrapWorker(AccessWorkerModule, AccessEventRunner).catch(
  reportWorkerBootstrapError,
);
