import { BelongsTo, Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { EquipmentModel } from '../equipment/equipment.model';
import { ExerciseModel } from './exercise.model';

@Table({ tableName: 'ejercicios_equipos', underscored: true, timestamps: true })
export class ExerciseEquipmentModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => ExerciseModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'ejercicio_id' })
  declare ejercicioId: string;

  @ForeignKey(() => EquipmentModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'equipo_gym_id' })
  declare equipoGymId: string;

  @BelongsTo(() => ExerciseModel)
  declare ejercicio?: ExerciseModel;

  @BelongsTo(() => EquipmentModel)
  declare equipo?: EquipmentModel;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
