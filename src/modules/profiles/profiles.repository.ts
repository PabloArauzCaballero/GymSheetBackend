import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Transaction } from "sequelize";
import { UserModel } from "../users/user.model";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { UpsertProfileInput } from "./profiles.schemas";

/** A profile together with the account birth date it is presented with. */
export type StoredProfile = { profile: AnthropometricProfileModel; birthDate: string | null };

@Injectable()
export class ProfilesRepository {
  constructor(
    @InjectModel(AnthropometricProfileModel)
    private readonly profileModel: typeof AnthropometricProfileModel,
    @InjectModel(UserModel)
    private readonly userModel: typeof UserModel,
  ) {}

  async findByUserId(userId: string, transaction?: Transaction): Promise<StoredProfile | null> {
    const profile = await this.profileModel.findOne({ where: { userId }, transaction });
    if (!profile) return null;
    return { profile, birthDate: await this.findBirthDate(userId, transaction) };
  }

  runInTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    if (!this.profileModel.sequelize) throw new Error("Profile database connection is unavailable.");
    return this.profileModel.sequelize.transaction(work);
  }

  /** Writes the profile and, when sent, the account birth date atomically. */
  async upsertByUserId(
    userId: string,
    input: UpsertProfileInput,
    transaction?: Transaction,
  ): Promise<StoredProfile> {
    if (!transaction) {
      return this.runInTransaction((ownTransaction) => this.upsertByUserId(userId, input, ownTransaction));
    }
    // An absent `birthDate` means "leave it": an older app that does not know
    // the field must not erase it while saving the weight.
    if (input.birthDate !== undefined) {
      await this.userModel.update({ birthDate: input.birthDate }, { where: { id: userId }, transaction });
    }
    const values = { weightKg: input.weightKg, heightCm: input.heightCm, goal: input.goal };
    const existingProfile = await this.profileModel.findOne({ where: { userId }, transaction });
    const profile = existingProfile
      ? await existingProfile.update({ ...values, measurementUpdatedAt: new Date() }, { transaction })
      : await this.profileModel.create({ userId, ...values }, { transaction });
    return { profile, birthDate: await this.findBirthDate(userId, transaction) };
  }

  private async findBirthDate(userId: string, transaction?: Transaction): Promise<string | null> {
    const user = await this.userModel.findByPk(userId, { attributes: ["id", "birthDate"], transaction });
    return user?.birthDate ?? null;
  }
}
