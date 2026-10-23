import { Column, CreatedAt, DataType, Default, Model, PrimaryKey, Table } from 'sequelize-typescript';
import type { SwapReason, SwapScope } from './free-workout';

/** Anchos de columna: los mismos de la migración `202610220001`. */
const REASON_LENGTH = 20;
const NOTE_LENGTH = 280;
const SCOPE_LENGTH = 10;

/** Un cambio de ejercicio durante un entreno (append-only). */
@Table({ tableName: 'sesiones_ejercicios_cambios', underscored: true, timestamps: true, updatedAt: false })
export class WorkoutExerciseSwapModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'usuario_id' })
  declare userId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'sesion_id' })
  declare sessionId: string;

  @Column({ type: DataType.UUID, allowNull: true, field: 'sesion_ejercicio_id' })
  declare sessionExerciseId: string | null;

  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_anterior_id' })
  declare fromExerciseId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_nuevo_id' })
  declare toExerciseId: string;

  @Column({ type: DataType.STRING(REASON_LENGTH), allowNull: false, field: 'motivo' })
  declare reason: SwapReason;

  @Column({ type: DataType.STRING(NOTE_LENGTH), allowNull: true, field: 'nota' })
  declare note: string | null;

  @Column({ type: DataType.STRING(SCOPE_LENGTH), allowNull: false, field: 'alcance' })
  declare scope: SwapScope;

  @Column({ type: DataType.UUID, allowNull: true, field: 'rutina_id' })
  declare routineId: string | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;
}
