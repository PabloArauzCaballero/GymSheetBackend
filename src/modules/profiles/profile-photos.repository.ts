import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Op } from "sequelize";
import type { Transaction } from "sequelize";
import type { StoredAsset } from "../media/media-storage.port";
import { ProfilePhotoModel } from "./profile-photo.model";

@Injectable()
export class ProfilePhotosRepository {
  constructor(
    @InjectModel(ProfilePhotoModel)
    private readonly photos: typeof ProfilePhotoModel,
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

  countByUser(userId: string): Promise<number> {
    return this.photos.count({ where: { userId } });
  }

  findByIdForUser(id: string, userId: string): Promise<ProfilePhotoModel | null> {
    return this.photos.findOne({ where: { id, userId } });
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
