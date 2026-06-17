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
exports.ExercisesRepository = void 0;
const common_1 = require("@nestjs/common");
const sequelize_1 = require("@nestjs/sequelize");
const sequelize_2 = require("sequelize");
const domain_enums_1 = require("../../common/enums/domain.enums");
const equipment_model_1 = require("../equipment/equipment.model");
const exercise_equipment_model_1 = require("./exercise-equipment.model");
const exercise_model_1 = require("./exercise.model");
const user_exercise_model_1 = require("./user-exercise.model");
let ExercisesRepository = class ExercisesRepository {
    constructor(exerciseModel, exerciseEquipmentModel, userExerciseModel) {
        this.exerciseModel = exerciseModel;
        this.exerciseEquipmentModel = exerciseEquipmentModel;
        this.userExerciseModel = userExerciseModel;
    }
    listVisibleForUser(userId, filters) {
        const where = {
            estado: domain_enums_1.ExerciseStatus.ACTIVO,
            [sequelize_2.Op.or]: [
                { tipoEjercicio: domain_enums_1.ExerciseType.GLOBAL },
                { tipoEjercicio: domain_enums_1.ExerciseType.PERSONAL, createdByUsuarioId: userId },
            ],
        };
        if (filters.grupoMuscular) {
            where.grupoMuscular = filters.grupoMuscular;
        }
        return this.exerciseModel.findAll({
            where,
            include: [
                {
                    model: exercise_equipment_model_1.ExerciseEquipmentModel,
                    required: Boolean(filters.equipoId),
                    where: filters.equipoId ? { equipoGymId: filters.equipoId } : undefined,
                    include: [equipment_model_1.EquipmentModel],
                },
            ],
            order: [['nombre', 'ASC']],
        });
    }
    findVisibleById(id, userId) {
        return this.exerciseModel.findOne({
            where: {
                id,
                estado: domain_enums_1.ExerciseStatus.ACTIVO,
                [sequelize_2.Op.or]: [
                    { tipoEjercicio: domain_enums_1.ExerciseType.GLOBAL },
                    { tipoEjercicio: domain_enums_1.ExerciseType.PERSONAL, createdByUsuarioId: userId },
                ],
            },
            include: [{ model: exercise_equipment_model_1.ExerciseEquipmentModel, include: [equipment_model_1.EquipmentModel] }],
        });
    }
    createGlobal(input, transaction) {
        return this.exerciseModel.create({
            nombre: input.nombre,
            grupoMuscular: input.grupoMuscular,
            descripcion: input.descripcion ?? null,
            tipoEjercicio: domain_enums_1.ExerciseType.GLOBAL,
            createdByUsuarioId: null,
        }, { transaction });
    }
    createPersonal(userId, input, transaction) {
        return this.exerciseModel.create({
            nombre: input.nombre,
            grupoMuscular: input.grupoMuscular,
            descripcion: input.descripcion ?? null,
            tipoEjercicio: domain_enums_1.ExerciseType.PERSONAL,
            createdByUsuarioId: userId,
        }, { transaction });
    }
    async replaceExerciseEquipment(ejercicioId, equipoIds, transaction) {
        await this.exerciseEquipmentModel.destroy({ where: { ejercicioId }, transaction });
        if (equipoIds.length === 0)
            return;
        await this.exerciseEquipmentModel.bulkCreate(equipoIds.map((equipoGymId) => ({ ejercicioId, equipoGymId })), { transaction });
    }
    async updateExercise(exercise, input, transaction) {
        await exercise.update({
            nombre: input.nombre ?? exercise.nombre,
            grupoMuscular: input.grupoMuscular ?? exercise.grupoMuscular,
            descripcion: input.descripcion === undefined ? exercise.descripcion : input.descripcion,
        }, { transaction });
        return exercise;
    }
    async markInactive(exercise) {
        await exercise.update({ estado: domain_enums_1.ExerciseStatus.INACTIVO });
        return exercise;
    }
    findFavorite(userId, exerciseId) {
        return this.userExerciseModel.findOne({ where: { usuarioId: userId, ejercicioId: exerciseId } });
    }
    listFavorites(userId) {
        return this.userExerciseModel.findAll({
            where: { usuarioId: userId },
            include: [exercise_model_1.ExerciseModel],
            order: [['fechaSeleccion', 'DESC']],
        });
    }
    createFavorite(userId, exerciseId) {
        return this.userExerciseModel.create({ usuarioId: userId, ejercicioId: exerciseId });
    }
    async deleteFavorite(userId, exerciseId) {
        return this.userExerciseModel.destroy({ where: { usuarioId: userId, ejercicioId: exerciseId } });
    }
};
exports.ExercisesRepository = ExercisesRepository;
exports.ExercisesRepository = ExercisesRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, sequelize_1.InjectModel)(exercise_model_1.ExerciseModel)),
    __param(1, (0, sequelize_1.InjectModel)(exercise_equipment_model_1.ExerciseEquipmentModel)),
    __param(2, (0, sequelize_1.InjectModel)(user_exercise_model_1.UserExerciseModel)),
    __metadata("design:paramtypes", [Object, Object, Object])
], ExercisesRepository);
//# sourceMappingURL=exercises.repository.js.map