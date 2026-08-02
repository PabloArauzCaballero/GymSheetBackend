import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/sequelize";
import { Transaction } from "sequelize";
import { OnboardingStatus } from "../../common/enums/domain.enums";
import { AnthropometricProfileModel } from "./anthropometric-profile.model";
import { BodyMeasurementModel } from "./body-measurement.model";
import { OnboardingModel } from "./onboarding.model";

@Injectable()
export class OnboardingRepository {
  constructor(
    @InjectModel(OnboardingModel)
    private readonly onboarding: typeof OnboardingModel,
    @InjectModel(BodyMeasurementModel)
    private readonly measurements: typeof BodyMeasurementModel,
    @InjectModel(AnthropometricProfileModel)
    private readonly profiles: typeof AnthropometricProfileModel,
  ) {}

  async getOrCreate(userId: string, transaction?: Transaction) {
    const [state] = await this.onboarding.findOrCreate({
      where: { userId },
      defaults: {
        userId,
        status: OnboardingStatus.NOT_STARTED,
        currentStep: 1,
        completedSteps: [],
        version: 1,
        primaryGoal: null,
        experienceLevel: null,
        weeklyFrequency: null,
        trainingLocation: null,
        availableEquipment: [],
        trainingPreferences: [],
        physicalConsiderations: null,
        weightUnit: "KG",
        heightUnit: "CM",
        heightValue: null,
        consentHealth: false,
        consentData: false,
        startedAt: null,
        completedAt: null,
      },
      transaction,
    });
    return state;
  }

  findForUpdate(userId: string, transaction: Transaction) {
    return this.onboarding.findByPk(userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
  }

  createMeasurement(input: Record<string, unknown>, transaction?: Transaction) {
    return this.measurements.create(input, { transaction });
  }

  latestMeasurement(userId: string, transaction?: Transaction) {
    return this.measurements.findOne({
      where: { userId },
      order: [
        ["measuredOn", "DESC"],
        ["createdAt", "DESC"],
      ],
      transaction,
    });
  }

  listMeasurements(userId: string) {
    return this.measurements.findAll({
      where: { userId },
      order: [
        ["measuredOn", "DESC"],
        ["createdAt", "DESC"],
      ],
    });
  }

  findMeasurementByKey(
    userId: string,
    idempotencyKey: string,
    transaction?: Transaction,
  ) {
    return this.measurements.findOne({
      where: { userId, idempotencyKey },
      transaction,
    });
  }

  async upsertProjection(
    userId: string,
    values: Record<string, unknown>,
    transaction: Transaction,
  ) {
    const existing = await this.profiles.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existing) {
      await existing.update(values, { transaction });
      return existing;
    }
    return this.profiles.create(
      { userId, age: null, ...values },
      { transaction },
    );
  }
}
