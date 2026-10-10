import {
  Column,
  CreatedAt,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

export type RoutineShareStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
export type RoutineShareOrigin = 'INVITACION' | 'ENTRENADOR';

/** Invitación a ver una rutina privada. Hasta que se acepta, el invitado no ve los ejercicios. */
@Table({ tableName: 'routine_shares', schema: 'training', underscored: true, timestamps: true })
export class RoutineShareModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'routine_id' })
  declare routineId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'propietario_id' })
  declare ownerId: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'invitado_id' })
  declare inviteeId: string;

  @Column({ type: DataType.STRING(12), allowNull: false, field: 'estado' })
  declare status: RoutineShareStatus;

  @Default('INVITACION')
  @Column({ type: DataType.STRING(12), allowNull: false, field: 'origen' })
  declare origin: RoutineShareOrigin;

  @Column({ type: DataType.DATE, allowNull: true, field: 'respondida_en' })
  declare respondedAt: Date | null;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
