import { StoriesPurgeRunner } from "./stories-purge.runner";
import { StoriesWorkerModule } from "./stories-worker.module";
import {
  bootstrapWorker,
  reportWorkerBootstrapError,
} from "./worker-bootstrap";

void bootstrapWorker(StoriesWorkerModule, StoriesPurgeRunner).catch(
  reportWorkerBootstrapError,
);
