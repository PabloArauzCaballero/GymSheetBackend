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
exports.WorkoutsService = void 0;
const common_1 = require("@nestjs/common");
const sequelize_typescript_1 = require("sequelize-typescript");
const domain_enums_1 = require("../../common/enums/domain.enums");
const exercises_service_1 = require("../exercises/exercises.service");
const workouts_repository_1 = require("./workouts.repository");
let WorkoutsService = class WorkoutsService {
    constructor(workoutsRepository, exercisesService, sequelize) {
        this.workoutsRepository = workoutsRepository;
        this.exercisesService = exercisesService;
        this.sequelize = sequelize;
    }
    startSession(userId, input) {
        return this.workoutsRepository.createSession(userId, input);
    }
    listMySessions(userId) {
        return this.workoutsRepository.listSessionsForUser(userId);
    }
    async getMySession(userId, sessionId) {
        const session = await this.workoutsRepository.findSessionByIdForUser(sessionId, userId);
        if (!session) {
            throw new common_1.NotFoundException('Sesión de entrenamiento no encontrada.');
        }
        return session;
    }
    async finishSession(userId, sessionId) {
        const session = await this.getMySession(userId, sessionId);
        this.assertSessionInProgress(session.estado);
        return this.workoutsRepository.changeSessionStatus(session, domain_enums_1.WorkoutSessionStatus.FINALIZADA);
    }
    async cancelSession(userId, sessionId) {
        const session = await this.getMySession(userId, sessionId);
        this.assertSessionInProgress(session.estado);
        return this.workoutsRepository.changeSessionStatus(session, domain_enums_1.WorkoutSessionStatus.CANCELADA);
    }
    async addExerciseToSession(userId, sessionId, input) {
        const session = await this.getMySession(userId, sessionId);
        this.assertSessionInProgress(session.estado);
        await this.exercisesService.getVisibleExerciseOrFail(input.ejercicioId, userId);
        return this.workoutsRepository.addExerciseToSession(sessionId, input);
    }
    async updateSessionExercise(userId, sessionExerciseId, input) {
        const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId);
        this.assertSessionInProgress(sessionExercise.sesion?.estado);
        return this.workoutsRepository.updateSessionExercise(sessionExercise, input);
    }
    async deleteSessionExercise(userId, sessionExerciseId) {
        const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId);
        this.assertSessionInProgress(sessionExercise.sesion?.estado);
        await this.workoutsRepository.deleteSessionExercise(sessionExerciseId);
        return { deleted: true };
    }
    async addSet(userId, sessionExerciseId, input) {
        const sessionExercise = await this.getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId);
        this.assertSessionInProgress(sessionExercise.sesion?.estado);
        return this.sequelize.transaction(async (transaction) => {
            const duplicatedSet = await this.workoutsRepository.findSetBySessionExerciseAndNumber(sessionExerciseId, input.numeroSerie);
            if (duplicatedSet) {
                throw new common_1.ConflictException('Ya existe una serie con ese número para este ejercicio de la sesión.');
            }
            return this.workoutsRepository.createSet(sessionExerciseId, input, transaction);
        });
    }
    async updateSet(userId, setId, input) {
        const set = await this.getSetOwnedByUserOrFail(userId, setId);
        this.assertSessionInProgress(set.sesionEjercicio?.sesion?.estado);
        return this.workoutsRepository.updateSet(set, input);
    }
    async deleteSet(userId, setId) {
        const set = await this.getSetOwnedByUserOrFail(userId, setId);
        this.assertSessionInProgress(set.sesionEjercicio?.sesion?.estado);
        await this.workoutsRepository.deleteSet(set.id);
        return { deleted: true };
    }
    async getSessionExerciseOwnedByUserOrFail(userId, sessionExerciseId) {
        const sessionExercise = await this.workoutsRepository.findSessionExerciseById(sessionExerciseId);
        if (!sessionExercise || sessionExercise.sesion?.usuarioId !== userId) {
            throw new common_1.NotFoundException('Ejercicio de sesión no encontrado.');
        }
        return sessionExercise;
    }
    async getSetOwnedByUserOrFail(userId, setId) {
        const set = await this.workoutsRepository.findSetById(setId);
        if (!set || set.sesionEjercicio?.sesion?.usuarioId !== userId) {
            throw new common_1.NotFoundException('Serie no encontrada.');
        }
        return set;
    }
    assertSessionInProgress(status) {
        if (status !== domain_enums_1.WorkoutSessionStatus.EN_PROGRESO) {
            throw new common_1.ForbiddenException('Solo se puede modificar una sesión en progreso.');
        }
    }
};
exports.WorkoutsService = WorkoutsService;
exports.WorkoutsService = WorkoutsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [workouts_repository_1.WorkoutsRepository,
        exercises_service_1.ExercisesService,
        sequelize_typescript_1.Sequelize])
], WorkoutsService);
//# sourceMappingURL=workouts.service.js.map