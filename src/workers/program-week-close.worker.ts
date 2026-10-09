import { ProgramWeekCloseRunner } from "./program-week-close.runner";
import { ProgramsWorkerModule } from "./programs-worker.module";
import {
  bootstrapWorker,
  reportWorkerBootstrapError,
} from "./worker-bootstrap";

void bootstrapWorker(ProgramsWorkerModule, ProgramWeekCloseRunner).catch(
  reportWorkerBootstrapError,
);
