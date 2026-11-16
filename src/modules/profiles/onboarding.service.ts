import {
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Transaction } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import {
  FitnessGoal,
  OnboardingStatus,
  TrainingGoal,
} from "../../common/enums/domain.enums";
import { DomainException } from "../../common/errors/domain.exception";
import { ConsentsService } from "../consents/consents.service";
import { CONSENT_VERSIONS } from "../legal/consent-versions";
import type { LegalChannel } from "../legal/legal-client-context";
import { OnboardingRepository } from "./onboarding.repository";
import {
  BodyMeasurementInput,
  OnboardingEquipmentInput,
  OnboardingGoalsInput,
  OnboardingPreferencesInput,
  OnboardingProfileInput,
  OnboardingSocialStepInput,
} from "./onboarding.schemas";

const legacyGoal: Record<FitnessGoal, TrainingGoal> = {
  [FitnessGoal.GAIN_MUSCLE]: TrainingGoal.HYPERTROPHY,
  [FitnessGoal.LOSE_FAT]: TrainingGoal.FAT_LOSS,
  [FitnessGoal.IMPROVE_STRENGTH]: TrainingGoal.STRENGTH,
  [FitnessGoal.IMPROVE_ENDURANCE]: TrainingGoal.ENDURANCE,
  [FitnessGoal.MAINTAIN_FITNESS]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.GENERAL_HEALTH]: TrainingGoal.GENERAL_HEALTH,
  [FitnessGoal.SPORT_PERFORMANCE]: TrainingGoal.SPORT_PERFORMANCE,
};

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly sequelize: Sequelize,
    private readonly consents: ConsentsService,
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
      await this.advance(
        state,
        2,
        {
          weightUnit: input.weightUnit,
          heightUnit: input.heightUnit,
          heightValue: input.height,
        },
        transaction,
      );
    });
    return this.getState(userId);
  }

  async saveGoals(userId: string, input: OnboardingGoalsInput) {
    const state = await this.repository.getOrCreate(userId);
    await this.advance(state, 1, { primaryGoal: input.primaryGoal });
    return this.getState(userId);
  }

  /** Physical considerations are health data: kept only with the ledger HEALTH consent (ADR-0014). */
  async savePreferences(userId: string, input: OnboardingPreferencesInput, channel: LegalChannel) {
    const { consentHealthVersion, ...values } = input;
    if (values.physicalConsiderations && !values.consentHealth) {
      throw new DomainException(HttpStatus.BAD_REQUEST, "CONSENT_REQUIRED",
        "Para guardar tus consideraciones físicas primero tienes que dar tu consentimiento de salud.", { kind: "HEALTH" });
    }
    await this.sequelize.transaction(async (transaction) => {
      const state = await this.repository.getOrCreate(userId, transaction);
      // Without consent an open grant is revoked, which also erases any stored text.
      if (values.consentHealth) {
        await this.consents.grant(userId, "HEALTH", consentHealthVersion ?? CONSENT_VERSIONS.HEALTH, channel, transaction);
      } else await this.consents.revoke(userId, "HEALTH", transaction);
      await this.advance(state, 3, values.consentHealth ? values : { ...values, physicalConsiderations: null }, transaction);
    });
    return this.getState(userId);
  }

  async saveEquipment(userId: string, input: OnboardingEquipmentInput) {
    const state = await this.repository.getOrCreate(userId);
    await this.advance(state, 4, input);
    return this.getState(userId);
  }

  /** Skippable and resumable: a later DONE replaces SKIPPED; SKIP never undoes DONE. */
  async saveSocialStep(userId: string, input: OnboardingSocialStepInput) {
    const state = await this.repository.getOrCreate(userId);
    const socialStep =
      input.action === "DONE" || state.socialStep === "DONE" ? "DONE" : "SKIPPED";
    if (socialStep !== state.socialStep) await state.update({ socialStep });
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
          message: "Faltan datos obligatorios para completar el onboarding.",
          code: "ONBOARDING_INCOMPLETE",
          details: { missingFields: missing },
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
    transaction?: Transaction,
  ) {
    const completedSteps = [...new Set([...state.completedSteps, step])].sort();
    // Con `transaction` la fila recién creada por getOrCreate (aún sin confirmar)
    // es visible; sin ella el UPDATE no afectaba ninguna fila y se perdían la
    // altura y el paso 2, lo que dejaba `complete` en 422 para usuarios nuevos.
    await state.update(
      {
        ...values,
        status: OnboardingStatus.IN_PROGRESS,
        currentStep: Math.min(5, Math.max(state.currentStep, step + 1)),
        completedSteps,
        startedAt: state.startedAt ?? new Date(),
        completedAt: null,
      },
      { transaction },
    );
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
      // Health consent is optional; it only blocks when health data was kept without it.
      Boolean(state.physicalConsiderations) && !state.consentHealth && "consentHealth",
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
      socialStep: state.socialStep,
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
