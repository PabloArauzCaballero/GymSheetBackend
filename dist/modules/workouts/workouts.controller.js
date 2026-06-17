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
exports.WorkoutsController = void 0;
const common_1 = require("@nestjs/common");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const zod_validation_pipe_1 = require("../../common/pipes/zod-validation.pipe");
const workouts_service_1 = require("./workouts.service");
const workouts_schemas_1 = require("./workouts.schemas");
let WorkoutsController = class WorkoutsController {
    constructor(workoutsService) {
        this.workoutsService = workoutsService;
    }
    startSession(currentUser, input) {
        return this.workoutsService.startSession(currentUser.id, input);
    }
    listMySessions(currentUser) {
        return this.workoutsService.listMySessions(currentUser.id);
    }
    getMySession(currentUser, id) {
        return this.workoutsService.getMySession(currentUser.id, id);
    }
    finishSession(currentUser, id) {
        return this.workoutsService.finishSession(currentUser.id, id);
    }
    cancelSession(currentUser, id) {
        return this.workoutsService.cancelSession(currentUser.id, id);
    }
    addExerciseToSession(currentUser, sessionId, input) {
        return this.workoutsService.addExerciseToSession(currentUser.id, sessionId, input);
    }
    updateSessionExercise(currentUser, id, input) {
        return this.workoutsService.updateSessionExercise(currentUser.id, id, input);
    }
    deleteSessionExercise(currentUser, id) {
        return this.workoutsService.deleteSessionExercise(currentUser.id, id);
    }
    addSet(currentUser, id, input) {
        return this.workoutsService.addSet(currentUser.id, id, input);
    }
    updateSet(currentUser, id, input) {
        return this.workoutsService.updateSet(currentUser.id, id, input);
    }
    deleteSet(currentUser, id) {
        return this.workoutsService.deleteSet(currentUser.id, id);
    }
};
exports.WorkoutsController = WorkoutsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(workouts_schemas_1.createWorkoutSessionSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "startSession", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "listMySessions", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "getMySession", null);
__decorate([
    (0, common_1.Patch)(':id/finish'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "finishSession", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "cancelSession", null);
__decorate([
    (0, common_1.Post)(':sessionId/exercises'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('sessionId')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(workouts_schemas_1.addSessionExerciseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "addExerciseToSession", null);
__decorate([
    (0, common_1.Patch)('session-exercises/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(workouts_schemas_1.updateSessionExerciseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "updateSessionExercise", null);
__decorate([
    (0, common_1.Delete)('session-exercises/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "deleteSessionExercise", null);
__decorate([
    (0, common_1.Post)('session-exercises/:id/sets'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(workouts_schemas_1.createWorkoutSetSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "addSet", null);
__decorate([
    (0, common_1.Patch)('sets/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)(new zod_validation_pipe_1.ZodValidationPipe(workouts_schemas_1.updateWorkoutSetSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "updateSet", null);
__decorate([
    (0, common_1.Delete)('sets/:id'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WorkoutsController.prototype, "deleteSet", null);
exports.WorkoutsController = WorkoutsController = __decorate([
    (0, common_1.Controller)('workouts'),
    __metadata("design:paramtypes", [workouts_service_1.WorkoutsService])
], WorkoutsController);
//# sourceMappingURL=workouts.controller.js.map