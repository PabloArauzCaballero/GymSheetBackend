import { RecommendationsProjectionRunner } from "./recommendations-projection.runner";
import { RecommendationsWorkerModule } from "./recommendations-worker.module";
import { bootstrapWorker, reportWorkerBootstrapError } from "./worker-bootstrap";

void bootstrapWorker(RecommendationsWorkerModule, RecommendationsProjectionRunner).catch(reportWorkerBootstrapError);
