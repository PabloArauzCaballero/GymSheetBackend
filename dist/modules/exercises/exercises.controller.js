"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserExercisesController = exports.AdminExercisesController = exports.ExercisesController = void 0;
const common_1 = require("@nestjs/common");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const domain_enums_1 = require("../../common/enums/domain.enums");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const exercises_service_1 = require("./exercises.service");
const exercises_schemas_1 = require("./exercises.schemas");
let ExercisesController = class ExercisesController {
    constructor(exercisesService) {
        this.exercisesService = exercisesService;
    }
    listExercises(currentUser, filters) {
        return this.exercisesService.listVisibleForUser(currentUser.id, filters);
    }
    getExercise(currentUser, id) {
        return this.exercisesService.getVisibleExerciseOrFail(id, currentUser.id);
    }
    createPersonalExercise(currentUser, input) {
        return this.exercisesService.createPersonalExercise(currentUser.id, input);
    }
    updatePersonalExercise(currentUser, id, input) {
        return this.exercisesService.updatePersonalExercise(currentUser.id, id, input);
    }
    inactivatePersonalExercise(currentUser, id) {
        return this.exercisesService.inactivatePersonalExercise(currentUser.id, id);
    }
};
exports.ExercisesController = ExercisesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)(new zod_validation_pipe_1.ZodValidationPipe(exercises_schemas_1.exerciseFilterSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ExercisesController.prototype, "listExercises", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ExercisesController.prototype, "getExercise", null);
__decorate([
    (0, common_1.Post)('personal'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(exercises_schemas_1.createPersonalExerciseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ExercisesController.prototype, "createPersonalExercise", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(exercises_schemas_1.updateExerciseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ExercisesController.prototype, "updatePersonalExercise", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ExercisesController.prototype, "inactivatePersonalExercise", null);
exports.ExercisesController = ExercisesController = __decorate([
    (0, common_1.Controller)('exercises'),
    __metadata("design:paramtypes", [exercises_service_1.ExercisesService])
], ExercisesController);
let AdminExercisesController = class AdminExercisesController {
    constructor(exercisesService) {
        this.exercisesService = exercisesService;
    }
    createGlobalExercise(input) {
        return this.exercisesService.createGlobalExercise(input);
    }
    updateGlobalExercise(id, input) {
        return this.exercisesService.updateGlobalExercise(id, input);
    }
    inactivateGlobalExercise(id) {
        return this.exercisesService.inactivateGlobalExercise(id);
    }
};
exports.AdminExercisesController = AdminExercisesController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(exercises_schemas_1.createGlobalExerciseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminExercisesController.prototype, "createGlobalExercise", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(exercises_schemas_1.updateExerciseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminExercisesController.prototype, "updateGlobalExercise", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminExercisesController.prototype, "inactivateGlobalExercise", null);
exports.AdminExercisesController = AdminExercisesController = __decorate([
    (0, roles_decorator_1.Roles)(domain_enums_1.UserRole.ADMIN),
    (0, common_1.Controller)('admin/exercises/global'),
    __metadata("design:paramtypes", [exercises_service_1.ExercisesService])
], AdminExercisesController);
let UserExercisesController = class UserExercisesController {
    constructor(exercisesService) {
        this.exercisesService = exercisesService;
    }
    listFavorites(currentUser) {
        return this.exercisesService.listFavorites(currentUser.id);
    }
    addFavorite(currentUser, exerciseId) {
        return this.exercisesService.addFavorite(currentUser.id, exerciseId);
    }
    removeFavorite(currentUser, exerciseId) {
        return this.exercisesService.removeFavorite(currentUser.id, exerciseId);
    }
};
exports.UserExercisesController = UserExercisesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UserExercisesController.prototype, "listFavorites", null);
__decorate([
    (0, common_1.Post)(':exerciseId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('exerciseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], UserExercisesController.prototype, "addFavorite", null);
__decorate([
    (0, common_1.Delete)(':exerciseId'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('exerciseId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], UserExercisesController.prototype, "removeFavorite", null);
exports.UserExercisesController = UserExercisesController = __decorate([
    (0, common_1.Controller)('user-exercises'),
    __metadata("design:paramtypes", [exercises_service_1.ExercisesService])
], UserExercisesController);
//# sourceMappingURL=exercises.controller.js.map