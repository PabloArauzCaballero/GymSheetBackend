import { ExercisesDatasetRefreshRunner } from "./exercises-dataset-refresh.runner";
import { ExercisesDatasetWorkerModule } from "./exercises-dataset-worker.module";
import {
  bootstrapWorker,
  reportWorkerBootstrapError,
} from "./worker-bootstrap";

void bootstrapWorker(
  ExercisesDatasetWorkerModule,
  ExercisesDatasetRefreshRunner,
).catch(reportWorkerBootstrapError);
