import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { AnthropometricProfileModel } from './anthropometric-profile.model';
import { UpsertProfileInput } from './profiles.schemas';

@Injectable()
export class ProfilesRepository {
  constructor(@InjectModel(AnthropometricProfileModel) private readonly profileModel: typeof AnthropometricProfileModel) {}

  findByUserId(usuarioId: string): Promise<AnthropometricProfileModel | null> {
    return this.profileModel.findOne({ where: { usuarioId } });
  }

  async upsertByUserId(usuarioId: string, input: UpsertProfileInput): Promise<AnthropometricProfileModel> {
    const existingProfile = await this.findByUserId(usuarioId);

    if (existingProfile) {
      await existingProfile.update({
        edad: input.edad,
        pesoKg: input.pesoKg,
        estaturaCm: input.estaturaCm,
        objetivo: input.objetivo,
        fechaActualizacion: new Date(),
      });
      return existingProfile;
    }

    return this.profileModel.create({
      usuarioId,
      edad: input.edad,
      pesoKg: input.pesoKg,
      estaturaCm: input.estaturaCm,
      objetivo: input.objetivo,
    });
  }
}
