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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExercisesService = void 0;
const common_1 = require("@nestjs/common");
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
const exercises_repository_1 = require("./exercises.repository");
let ExercisesService = class ExercisesService {
    constructor(exercisesRepository, sequelize) {
        this.exercisesRepository = exercisesRepository;
        this.sequelize = sequelize;
    }
    listVisibleForUser(userId, filters) {
        return this.exercisesRepository.listVisibleForUser(userId, filters);
    }
    async getVisibleExerciseOrFail(exerciseId, userId) {
        const exercise = await this.exercisesRepository.findVisibleById(exerciseId, userId);
        if (!exercise) {
            throw new common_1.NotFoundException('Ejercicio no encontrado o no visible para el usuario.');
        }
        return exercise;
    }
    async createGlobalExercise(input) {
        return this.sequelize.transaction(async (transaction) => {
            const exercise = await this.exercisesRepository.createGlobal(input, transaction);
            await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds ?? [], transaction);
            return this.exercisesRepository.findVisibleById(exercise.id, '00000000-0000-0000-0000-000000000000');
        });
    }
    async createPersonalExercise(userId, input) {
        return this.sequelize.transaction(async (transaction) => {
            const exercise = await this.exercisesRepository.createPersonal(userId, input, transaction);
            await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds ?? [], transaction);
            return this.exercisesRepository.findVisibleById(exercise.id, userId);
        });
    }
    async updatePersonalExercise(userId, exerciseId, input) {
        const exercise = await this.getVisibleExerciseOrFail(exerciseId, userId);
        if (exercise.tipoEjercicio !== domain_enums_1.ExerciseType.PERSONAL || exercise.createdByUsuarioId !== userId) {
            throw new common_1.ForbiddenException('Solo puedes editar tus ejercicios personales.');
        }
        return this.sequelize.transaction(async (transaction) => {
            await this.exercisesRepository.updateExercise(exercise, input, transaction);
            if (input.equipoIds) {
                await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds, transaction);
            }
            return this.exercisesRepository.findVisibleById(exercise.id, userId);
        });
    }
    async updateGlobalExercise(exerciseId, input) {
        const exercise = await this.getVisibleExerciseOrFail(exerciseId, '00000000-0000-0000-0000-000000000000');
        if (exercise.tipoEjercicio !== domain_enums_1.ExerciseType.GLOBAL) {
            throw new common_1.ForbiddenException('Este endpoint solo modifica ejercicios globales.');
        }
        return this.sequelize.transaction(async (transaction) => {
            await this.exercisesRepository.updateExercise(exercise, input, transaction);
            if (input.equipoIds) {
                await this.exercisesRepository.replaceExerciseEquipment(exercise.id, input.equipoIds, transaction);
            }
            return this.exercisesRepository.findVisibleById(exercise.id, '00000000-0000-0000-0000-000000000000');
        });
    }
    async inactivatePersonalExercise(userId, exerciseId) {
        const exercise = await this.getVisibleExerciseOrFail(exerciseId, userId);
        if (exercise.tipoEjercicio !== domain_enums_1.ExerciseType.PERSONAL || exercise.createdByUsuarioId !== userId) {
            throw new common_1.ForbiddenException('Solo puedes inhabilitar tus ejercicios personales.');
        }
        return this.exercisesRepository.markInactive(exercise);
    }
    async inactivateGlobalExercise(exerciseId) {
        const exercise = await this.getVisibleExerciseOrFail(exerciseId, '00000000-0000-0000-0000-000000000000');
        return this.exercisesRepository.markInactive(exercise);
    }
    listFavorites(userId) {
        return this.exercisesRepository.listFavorites(userId);
    }
    async addFavorite(userId, exerciseId) {
        await this.getVisibleExerciseOrFail(exerciseId, userId);
        const existingFavorite = await this.exercisesRepository.findFavorite(userId, exerciseId);
        if (existingFavorite) {
            throw new common_1.ConflictException('El ejercicio ya está seleccionado como frecuente.');
        }
        return this.exercisesRepository.createFavorite(userId, exerciseId);
    }
    async removeFavorite(userId, exerciseId) {
        const deletedRows = await this.exercisesRepository.deleteFavorite(userId, exerciseId);
        if (deletedRows === 0) {
            throw new common_1.NotFoundException('Ejercicio frecuente no encontrado.');
        }
        return { deleted: true };
    }
};
exports.ExercisesService = ExercisesService;
exports.ExercisesService = ExercisesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [exercises_repository_1.ExercisesRepository,
        sequelize_typescript_1.Sequelize])
], ExercisesService);
//# sourceMappingURL=exercises.service.js.map