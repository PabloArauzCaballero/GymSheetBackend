import { MembershipReminderRunner } from './membership-reminder.runner';
import { NotificationWorkerModule } from './notification-worker.module';
import { bootstrapWorker, reportWorkerBootstrapError } from './worker-bootstrap';

void bootstrapWorker(NotificationWorkerModule, MembershipReminderRunner).catch(
  reportWorkerBootstrapError,
);
