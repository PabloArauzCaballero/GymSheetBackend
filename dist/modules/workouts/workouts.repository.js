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
exports.WorkoutsRepository = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const exercise_model_1 = require("../exercises/exercise.model");
const workout_session_exercise_model_1 = require("./workout-session-exercise.model");
const workout_session_model_1 = require("./workout-session.model");
const workout_set_model_1 = require("./workout-set.model");
let WorkoutsRepository = class WorkoutsRepository {
    constructor(sessionModel, sessionExerciseModel, setModel) {
        this.sessionModel = sessionModel;
        this.sessionExerciseModel = sessionExerciseModel;
        this.setModel = setModel;
    }
    createSession(userId, input) {
        return this.sessionModel.create({ usuarioId: userId, observacion: input.observacion ?? null });
    }
    findSessionByIdForUser(sessionId, userId) {
        return this.sessionModel.findOne({
            where: { id: sessionId, usuarioId: userId },
            include: [{ model: workout_session_exercise_model_1.WorkoutSessionExerciseModel, include: [exercise_model_1.ExerciseModel, workout_set_model_1.WorkoutSetModel] }],
        });
    }
    listSessionsForUser(userId) {
        return this.sessionModel.findAll({
            where: { usuarioId: userId },
            include: [{ model: workout_session_exercise_model_1.WorkoutSessionExerciseModel, include: [exercise_model_1.ExerciseModel, workout_set_model_1.WorkoutSetModel] }],
            order: [['fechaInicio', 'DESC']],
        });
    }
    async changeSessionStatus(session, status) {
        await session.update({ estado: status, fechaFin: new Date() });
        return session;
    }
    addExerciseToSession(sessionId, input) {
        return this.sessionExerciseModel.create({
            sesionId: sessionId,
            ejercicioId: input.ejercicioId,
            orden: input.orden,
            esEnfasis: input.esEnfasis,
            nota: input.nota ?? null,
        });
    }
    findSessionExerciseById(id) {
        return this.sessionExerciseModel.findByPk(id, { include: [workout_session_model_1.WorkoutSessionModel, workout_set_model_1.WorkoutSetModel] });
    }
    async updateSessionExercise(sessionExercise, input) {
        await sessionExercise.update(input);
        return sessionExercise;
    }
    deleteSessionExercise(id) {
        return this.sessionExerciseModel.destroy({ where: { id } });
    }
    findSetBySessionExerciseAndNumber(sessionExerciseId, numeroSerie) {
        return this.setModel.findOne({ where: { sesionEjercicioId: sessionExerciseId, numeroSerie } });
    }
    createSet(sessionExerciseId, input, transaction) {
        return this.setModel.create({ sesionEjercicioId: sessionExerciseId, ...input }, { transaction });
    }
    findSetById(id) {
        return this.setModel.findByPk(id, { include: [{ model: workout_session_exercise_model_1.WorkoutSessionExerciseModel, include: [workout_session_model_1.WorkoutSessionModel] }] });
    }
    async updateSet(set, input) {
        await set.update(input);
        return set;
    }
    deleteSet(id) {
        return this.setModel.destroy({ where: { id } });
    }
};
exports.WorkoutsRepository = WorkoutsRepository;
exports.WorkoutsRepository = WorkoutsRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, sequelize_1.InjectModel)(workout_session_model_1.WorkoutSessionModel)),
    __param(1, (0, sequelize_1.InjectModel)(workout_session_exercise_model_1.WorkoutSessionExerciseModel)),
    __param(2, (0, sequelize_1.InjectModel)(workout_set_model_1.WorkoutSetModel)),
    __metadata("design:paramtypes", [Object, Object, Object])
], WorkoutsRepository);
//# sourceMappingURL=workouts.repository.js.map