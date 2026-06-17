"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkoutSessionStatus = exports.ExerciseStatus = exports.ExerciseType = exports.EquipmentStatus = exports.EquipmentType = exports.TrainingGoal = exports.UserStatus = exports.UserRole = void 0;
var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "ADMIN";
    UserRole["CLIENTE"] = "CLIENTE";
    UserRole["ENTRENADOR_EXTERNO"] = "ENTRENADOR_EXTERNO";
})(UserRole || (exports.UserRole = UserRole = {}));
var UserStatus;
(function (UserStatus) {
    UserStatus["ACTIVO"] = "ACTIVO";
    UserStatus["INACTIVO"] = "INACTIVO";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
var TrainingGoal;
(function (TrainingGoal) {
    TrainingGoal["HIPERTROFIA"] = "HIPERTROFIA";
    TrainingGoal["FUERZA"] = "FUERZA";
    TrainingGoal["RESISTENCIA"] = "RESISTENCIA";
    TrainingGoal["PERDIDA_GRASA"] = "PERDIDA_GRASA";
    TrainingGoal["SALUD_GENERAL"] = "SALUD_GENERAL";
    TrainingGoal["REHABILITACION"] = "REHABILITACION";
})(TrainingGoal || (exports.TrainingGoal = TrainingGoal = {}));
var EquipmentType;
(function (EquipmentType) {
    EquipmentType["MAQUINA"] = "MAQUINA";
    EquipmentType["MANCUERNA"] = "MANCUERNA";
    EquipmentType["BARRA"] = "BARRA";
    EquipmentType["DISCO"] = "DISCO";
    EquipmentType["BANCO"] = "BANCO";
    EquipmentType["POLEA"] = "POLEA";
    EquipmentType["BANDA"] = "BANDA";
    EquipmentType["ACCESORIO"] = "ACCESORIO";
    EquipmentType["OTRO"] = "OTRO";
})(EquipmentType || (exports.EquipmentType = EquipmentType = {}));
var EquipmentStatus;
(function (EquipmentStatus) {
    EquipmentStatus["DISPONIBLE"] = "DISPONIBLE";
    EquipmentStatus["MANTENIMIENTO"] = "MANTENIMIENTO";
    EquipmentStatus["INACTIVO"] = "INACTIVO";
})(EquipmentStatus || (exports.EquipmentStatus = EquipmentStatus = {}));
var ExerciseType;
(function (ExerciseType) {
    ExerciseType["GLOBAL"] = "GLOBAL";
    ExerciseType["PERSONAL"] = "PERSONAL";
})(ExerciseType || (exports.ExerciseType = ExerciseType = {}));
var ExerciseStatus;
(function (ExerciseStatus) {
    ExerciseStatus["ACTIVO"] = "ACTIVO";
    ExerciseStatus["INACTIVO"] = "INACTIVO";
})(ExerciseStatus || (exports.ExerciseStatus = ExerciseStatus = {}));
var WorkoutSessionStatus;
(function (WorkoutSessionStatus) {
    WorkoutSessionStatus["EN_PROGRESO"] = "EN_PROGRESO";
    WorkoutSessionStatus["FINALIZADA"] = "FINALIZADA";
    WorkoutSessionStatus["CANCELADA"] = "CANCELADA";
})(WorkoutSessionStatus || (exports.WorkoutSessionStatus = WorkoutSessionStatus = {}));
//# sourceMappingURL=domain.enums.js.map