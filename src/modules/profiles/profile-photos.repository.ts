import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op, QueryTypes } from "sequelize";
import type { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { hasOpenReportSql } from "../../common/moderation/open-report.sql";
import type { StoredAsset } from "../media/media-storage.port";
import { ProfilePhotoModel } from "./profile-photo.model";

@Injectable()
export class ProfilePhotosRepository {
  constructor(
    @InjectModel(ProfilePhotoModel)
    private readonly photos: typeof ProfilePhotoModel,
    private readonly sequelize: Sequelize,
  ) {}

  listByUser(userId: string): Promise<ProfilePhotoModel[]> {
    // Una foto retirada por moderación no se lista: deja de estar en la galería
    // para todo el mundo, su dueño incluido. El binario sigue en el almacén y el
    // caso queda en `moderation.reports`, así que la decisión es revisable.
    return this.photos.findAll({
      where: { userId, hiddenAt: { [Op.is]: null } },
      order: [["position", "ASC"]],
    });
  }

  /** A photo held as evidence after its author deleted it no longer takes a gallery slot. */
  countByUser(userId: string): Promise<number> {
    return this.photos.count({ where: { userId, authorDeletedAt: { [Op.is]: null } } });
  }

  /** For its owner, a photo held as evidence is already deleted. */
  findByIdForUser(id: string, userId: string): Promise<ProfilePhotoModel | null> {
    return this.photos.findOne({ where: { id, userId, authorDeletedAt: { [Op.is]: null } } });
  }

  /**
   * The author deletes a photo under an OPEN report: instead of deleting the
   * row it is marked and hidden (every reader skips `hidden_at`), keeping row
   * and file as evidence. Returns whether it was held.
   */
  async holdIfReported(id: string, transaction: Transaction): Promise<boolean> {
    const [, affected] = await this.sequelize.query(
      `UPDATE profile.photos t SET author_deleted_at = now(), hidden_at = COALESCE(t.hidden_at, now())
        WHERE t.id = :id AND t.author_deleted_at IS NULL AND ${hasOpenReportSql("PROFILE_PHOTO", "t.id")}`,
      { type: QueryTypes.UPDATE, replacements: { id }, transaction },
    );
    return Number(affected) > 0;
  }

  async create(userId: string, asset: StoredAsset, position: number): Promise<ProfilePhotoModel> {
    return this.photos.create({
      userId,
      url: asset.url,
      storageProvider: asset.provider,
      storageKey: asset.key,
      position,
    });
  }

  async delete(
    photo: ProfilePhotoModel,
    transaction?: Transaction,
  ): Promise<void> {
    await photo.destroy({ transaction });
  }
}
