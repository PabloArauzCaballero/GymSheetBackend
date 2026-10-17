import { Column, CreatedAt, DataType, Default, ForeignKey, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { UserModel } from '../users/user.model';
import type { SpotifyContentType } from './spotify-url';

export type MusicPlaylistVisibility = 'PUBLIC' | 'PRIVATE';

/** Enlace a Spotify compartido por un socio. No hay audio ni integración: solo el enlace. */
@Table({ tableName: 'music_playlists', schema: 'community', underscored: true, timestamps: true })
export class MusicPlaylistModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => UserModel)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  declare userId: string;

  @Column({ type: DataType.STRING(60), allowNull: false, field: 'tenant_id' })
  declare tenantId: string;

  @Column({ type: DataType.STRING(300), allowNull: false })
  declare url: string;

  @Column({ type: DataType.STRING(10), allowNull: false })
  declare tipo: SpotifyContentType;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare titulo: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'imagen_url' })
  declare imagenUrl: string | null;

  @Column({ type: DataType.STRING(10), allowNull: false })
  declare visibilidad: MusicPlaylistVisibility;

  @CreatedAt
  @Column({ field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ field: 'updated_at' })
  declare updatedAt: Date;

  /** Moderación: oculta de forma reversible (mismo contrato que stories y reels). */
  @Column({ type: DataType.DATE, allowNull: true, field: 'hidden_at' })
  declare hiddenAt: Date | null;
}
