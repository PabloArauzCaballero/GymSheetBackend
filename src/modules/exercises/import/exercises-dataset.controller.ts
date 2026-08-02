import { Body, Controller, Get, Post } from "@nestjs/common";
import { Roles } from "../../../common/decorators/roles.decorator";
import { UserRole } from "../../../common/enums/domain.enums";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import {
  ExerciseDatasetImportOptions,
  exerciseDatasetImportOptionsSchema,
} from "./exercises-dataset.schemas";
import { ExercisesDatasetService } from "./exercises-dataset.service";

@Roles(UserRole.ADMIN)
@Controller("admin/exercises/import")
export class ExercisesDatasetController {
  constructor(private readonly datasetService: ExercisesDatasetService) {}

  @Get("exercises-dataset/status")
  getExercisesDatasetStatus() {
    return this.datasetService.getRefreshStatus();
  }

  @Post("exercises-dataset")
  importExercisesDataset(
    @Body(new ZodValidationPipe(exerciseDatasetImportOptionsSchema))
    options: ExerciseDatasetImportOptions,
  ) {
    return this.datasetService.importDataset(options);
  }
}
