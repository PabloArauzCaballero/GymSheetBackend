import { NotificationDeliveryRunner } from './notification-delivery.runner';
import { NotificationWorkerModule } from './notification-worker.module';
import { bootstrapWorker, reportWorkerBootstrapError } from './worker-bootstrap';

void bootstrapWorker(NotificationWorkerModule, NotificationDeliveryRunner).catch(
  reportWorkerBootstrapError,
);
