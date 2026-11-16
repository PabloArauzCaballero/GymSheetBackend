import { PrivacyRetentionRunner } from "./privacy-retention.runner";
import { PrivacyRetentionWorkerModule } from "./privacy-retention-worker.module";
import { bootstrapWorker, reportWorkerBootstrapError } from "./worker-bootstrap";

void bootstrapWorker(PrivacyRetentionWorkerModule, PrivacyRetentionRunner).catch(reportWorkerBootstrapError);
