export enum UserRole {
  ADMIN = 'ADMIN',
  CLIENT = 'CLIENTE',
  EXTERNAL_TRAINER = 'ENTRENADOR_EXTERNO',
}

export enum UserStatus {
  ACTIVE = 'ACTIVO',
  INACTIVE = 'INACTIVO',
}

export enum TrainingGoal {
  HYPERTROPHY = 'HIPERTROFIA',
  STRENGTH = 'FUERZA',
  ENDURANCE = 'RESISTENCIA',
  FAT_LOSS = 'PERDIDA_GRASA',
  GENERAL_HEALTH = 'SALUD_GENERAL',
  REHABILITATION = 'REHABILITACION',
}

export enum EquipmentType {
  MACHINE = 'MAQUINA',
  DUMBBELL = 'MANCUERNA',
  BARBELL = 'BARRA',
  PLATE = 'DISCO',
  BENCH = 'BANCO',
  CABLE = 'POLEA',
  BAND = 'BANDA',
  ACCESSORY = 'ACCESORIO',
  OTHER = 'OTRO',
}

export enum EquipmentStatus {
  AVAILABLE = 'DISPONIBLE',
  MAINTENANCE = 'MANTENIMIENTO',
  INACTIVE = 'INACTIVO',
}

export enum ExerciseType {
  GLOBAL = 'GLOBAL',
  PERSONAL = 'PERSONAL',
}

export enum ExerciseStatus {
  ACTIVE = 'ACTIVO',
  INACTIVE = 'INACTIVO',
}

export enum WorkoutSessionStatus {
  IN_PROGRESS = 'EN_PROGRESO',
  COMPLETED = 'FINALIZADA',
  CANCELLED = 'CANCELADA',
}

export enum ExerciseMediaType {
  IMAGE = 'IMAGE',
  GIF = 'GIF',
  VIDEO = 'VIDEO',
}

export enum ExerciseMediaProvider {
  EXTERNAL_URL = 'EXTERNAL_URL',
  CLOUDINARY = 'CLOUDINARY',
  S3 = 'S3',
  LOCAL = 'LOCAL',
}

export enum ExerciseMediaStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum ExerciseDataSource {
  CUSTOM = 'CUSTOM',
  EXERCISES_DATASET = 'EXERCISES_DATASET',
}
