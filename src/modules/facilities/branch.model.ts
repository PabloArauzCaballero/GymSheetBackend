import { Column, CreatedAt, DataType, Default, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { FacilityStatus } from '../../common/enums/domain.enums';
import { AccessPointModel } from './access-point.model';
import { RoomModel } from './room.model';

@Table({ tableName: 'branches', schema: 'facilities', underscored: true, timestamps: true })
export class BranchModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  /** Gimnasio propietario. El código sólo es único dentro de él. */
  @Column({ type: DataType.STRING(60), allowNull: false, field: 'tenant_id' })
  declare tenantId: string;

  @Column({ type: DataType.STRING(60), allowNull: false })
  declare code: string;

  @Column({ type: DataType.STRING(180), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({ type: DataType.STRING(80), allowNull: false, field: 'time_zone' })
  declare timeZone: string;

  @Default(FacilityStatus.ACTIVE)
  @Column({ type: DataType.STRING(20), allowNull: false })
  declare status: FacilityStatus;

  @Default({})
  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  /**
   * Coordenadas para la verificación de racha por geolocalización. Nulas
   * hasta que el gimnasio las configure — sin ellas, esta sede simplemente no
   * participa de la verificación, no bloquea nada.
   */
  @Column({ type: DataType.DECIMAL(9, 6), allowNull: true })
  declare latitude: string | null;

  @Column({ type: DataType.DECIMAL(9, 6), allowNull: true })
  declare longitude: string | null;

  @Column({ type: DataType.INTEGER, allowNull: true, field: 'geofence_radius_m' })
  declare geofenceRadiusM: number | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'cover_image_url' })
  declare coverImageUrl: string | null;

  /** Cadena a la que pertenece esta sede (p. ej. "Megatlon"); nula si es independiente. */
  @Column({ type: DataType.STRING(180), allowNull: true, field: 'brand_name' })
  declare brandName: string | null;

  @Default([])
  @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: false })
  declare amenities: string[];

  @Default([])
  @Column({ type: DataType.ARRAY(DataType.TEXT), allowNull: false, field: 'gallery_image_urls' })
  declare galleryImageUrls: string[];

  @HasMany(() => RoomModel)
  declare rooms?: RoomModel[];

  @HasMany(() => AccessPointModel)
  declare accessPoints?: AccessPointModel[];

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;
}
