import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Sequelize } from "sequelize-typescript";
import {
  FitnessGoal,
  OnboardingStatus,
  TrainingGoal,
} from "../../common/enums/domain.enums";
import { OnboardingRepository } from "./onboarding.repository";
import {
  BodyMeasurementInput,
  OnboardingEquipmentInput,
  OnboardingGoalsInput,
  OnboardingPreferencesInput,
  OnboardingProfileInput,
} from "./onboarding.schemas";

const legacyGoal: Record<FitnessGoal, TrainingGoal> = {
  [FitnessGoal.GAIN_MUSCLE]: TrainingGoal.HYPERTROPHY,
  [FitnessGoal.LOSE_FAT]: TrainingGoal.FAT_LOSS,
  [FitnessGoal.IMPROVE_STRENGTH]: TrainingGoal.STRENGTH,
  [FitnessGoal.IMPROVE_ENDURANCE]: TrainingGoal.ENDURANCE,
  [FitnessGoal.MAINTAIN_FITNESS]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.GENERAL_HEALTH]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.SPORT_PERFORMANCE]: TrainingGoal.GENERAL_HEALTH,
};

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly sequelize: Sequelize,
  ) {}

  async getState(userId: string) {
    return this.mapState(await this.repository.getOrCreate(userId));
  }

  async saveProfile(userId: string, input: OnboardingProfileInput) {
    await this.sequelize.transaction(async (transaction) => {
      const state = await this.repository.getOrCreate(userId, transaction);
      const key =
        input.idempotencyKey ??
        `onboarding-profile:${input.measuredOn}:${input.weight}:${input.weightUnit}`;
      if (
        !(await this.repository.findMeasurementByKey(userId, key, transaction))
      ) {
        await this.repository.createMeasurement(
          {
            userId,
            weight: input.weight,
            unit: input.weightUnit,
            measuredOn: input.measuredOn,
            source: "ONBOARDING",
            createdByUserId: userId,
            idempotencyKey: key,
          },
          transaction,
        );
      }
      await this.advance(state, 2, {
        weightUnit: input.weightUnit,
        heightUnit: input.heightUnit,
        heightValue: input.height,
      });
    });
    return this.getState(userId);
  }

  async saveGoals(userId: string, input: OnboardingGoalsInput) {
    const state = await this.repository.getOrCreate(userId);
    await this.advance(state, 1, { primaryGoal: input.primaryGoal });
    return this.getState(userId);
  }

  async savePreferences(userId: string, input: OnboardingPreferencesInput) {
    const state = await this.repository.getOrCreate(userId);
    await this.advance(state, 3, input);
    return this.getState(userId);
  }

  async saveEquipment(userId: string, input: OnboardingEquipmentInput) {
    const state = await this.repository.getOrCreate(userId);
    await this.advance(state, 4, input);
    return this.getState(userId);
  }

  async complete(userId: string) {
    const completed = await this.sequelize.transaction(async (transaction) => {
      await this.repository.getOrCreate(userId, transaction);
      const state = await this.repository.findForUpdate(userId, transaction);
      if (!state)
        throw new ConflictException("No se pudo bloquear el onboarding.");
      const measurement = await this.repository.latestMeasurement(
        userId,
        transaction,
      );
      const missing = this.missingFields(state, Boolean(measurement));
      if (missing.length)
        throw new UnprocessableEntityException({
          message: "El onboarding todavía tiene datos obligatorios pendientes.",
          missingFields: missing,
        });
      if (state.status === OnboardingStatus.COMPLETED) return state;
      const weightKg =
        measurement!.unit === "LB"
          ? Number(measurement!.weight) * 0.45359237
          : Number(measurement!.weight);
      const heightCm =
        state.heightUnit === "IN"
          ? Number(state.heightValue) * 2.54
          : Number(state.heightValue);
      await this.repository.upsertProjection(
        userId,
        {
          weightKg,
          heightCm: Math.round(heightCm),
          goal: legacyGoal[state.primaryGoal!],
          measurementUpdatedAt: measurement!.createdAt,
        },
        transaction,
      );
      await state.update(
        {
          status: OnboardingStatus.COMPLETED,
          currentStep: 5,
          completedSteps: [1, 2, 3, 4, 5],
          completedAt: new Date(),
        },
        { transaction },
      );
      return state;
    });
    this.logger.log({
      event: "onboarding.completed",
      userId,
      correlationId: randomUUID(),
      version: completed.version,
    });
    return this.mapState(completed);
  }

  async addMeasurement(userId: string, input: BodyMeasurementInput) {
    const key = input.idempotencyKey ?? randomUUID();
    const existing = await this.repository.findMeasurementByKey(userId, key);
    const measurement =
      existing ??
      (await this.repository.createMeasurement({
        userId,
        ...input,
        source: "USER",
        createdByUserId: userId,
        idempotencyKey: key,
      }));
    return this.mapMeasurement(measurement);
  }

  async listMeasurements(userId: string) {
    return (await this.repository.listMeasurements(userId)).map((item) =>
      this.mapMeasurement(item),
    );
  }

  private async advance(
    state: Awaited<ReturnType<OnboardingRepository["getOrCreate"]>>,
    step: number,
    values: Record<string, unknown>,
  ) {
    const completedSteps = [...new Set([...state.completedSteps, step])].sort();
    await state.update({
      ...values,
      status: OnboardingStatus.IN_PROGRESS,
      currentStep: Math.min(5, Math.max(state.currentStep, step + 1)),
      completedSteps,
      startedAt: state.startedAt ?? new Date(),
      completedAt: null,
    });
    this.logger.log({
      event: "onboarding.step_completed",
      userId: state.userId,
      step,
      version: state.version,
    });
  }

  private missingFields(
    state: Awaited<ReturnType<OnboardingRepository["getOrCreate"]>>,
    hasMeasurement: boolean,
  ) {
    return [
      !hasMeasurement && "weight",
      !state.heightValue && "height",
      !state.primaryGoal && "primaryGoal",
      !state.experienceLevel && "experienceLevel",
      !state.weeklyFrequency && "weeklyFrequency",
      !state.trainingLocation && "trainingLocation",
      !state.consentHealth && "consentHealth",
      !state.consentData && "consentData",
    ].filter((item): item is string => Boolean(item));
  }

  private mapState(
    state: Awaited<ReturnType<OnboardingRepository["getOrCreate"]>>,
  ) {
    const missingFields = this.missingFields(state, state.completedSteps.includes(2));
    return {
      status: state.status,
      currentStep: state.currentStep,
      completedSteps: state.completedSteps,
      version: state.version,
      primaryGoal: state.primaryGoal,
      experienceLevel: state.experienceLevel,
      weeklyFrequency: state.weeklyFrequency,
      trainingLocation: state.trainingLocation,
      availableEquipment: state.availableEquipment,
      trainingPreferences: state.trainingPreferences,
      physicalConsiderations: state.physicalConsiderations,
      weightUnit: state.weightUnit,
      heightUnit: state.heightUnit,
      height: state.heightValue ? Number(state.heightValue) : null,
      consentHealth: state.consentHealth,
      consentData: state.consentData,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      missingFields,
      profileComplete:
        state.status === OnboardingStatus.COMPLETED &&
        missingFields.length === 0,
    };
  }

  private mapMeasurement(
    item: Awaited<ReturnType<OnboardingRepository["createMeasurement"]>>,
  ) {
    return {
      id: item.id,
      weight: Number(item.weight),
      unit: item.unit,
      measuredOn: item.measuredOn,
      source: item.source,
      createdAt: item.createdAt,
    };
  }
}
