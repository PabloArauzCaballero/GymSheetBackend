import { Transaction } from "sequelize";
import {
  FitnessGoal,
  OnboardingStatus,
  TrainingGoal,
} from "../../common/enums/domain.enums";
import { AnthropometricProfileModel } from "../../modules/profiles/anthropometric-profile.model";
import { BodyMeasurementModel } from "../../modules/profiles/body-measurement.model";
import { OnboardingModel } from "../../modules/profiles/onboarding.model";
import { UserModel } from "../../modules/users/user.model";

function dateOffset(days: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Onboarding states of the mock accounts. The gym-operated plans, features
 * and memberships it used to seed left the product with franja 8e (ADR-0026):
 * a subscription is now a confirmed marketplace order.
 */
export async function seedCustomerExperience(
  mode: "base" | "mock" | "all",
  transaction: Transaction,
) {
  if (mode === "base") return;

  const scenarios = [
    {
      email: "new.mock@gymsheet.local",
      onboarding: OnboardingStatus.NOT_STARTED,
    },
    {
      email: "onboarding.mock@gymsheet.local",
      onboarding: OnboardingStatus.IN_PROGRESS,
    },
    {
      email: "active.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
    },
    {
      email: "expiring.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
    },
    {
      email: "expired.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
    },
    {
      email: "pending.mock@gymsheet.local",
      onboarding: OnboardingStatus.COMPLETED,
    },
  ];
  for (const scenario of scenarios) {
    const user = await UserModel.findOne({
      where: { email: scenario.email },
      transaction,
    });
    if (!user) continue;
    const complete = scenario.onboarding === OnboardingStatus.COMPLETED;
    const partial = scenario.onboarding === OnboardingStatus.IN_PROGRESS;
    const [onboarding] = await OnboardingModel.findOrCreate({
      where: { userId: user.id },
      defaults: {
        userId: user.id,
        status: scenario.onboarding,
        currentStep: complete ? 5 : partial ? 3 : 1,
        completedSteps: complete ? [1, 2, 3, 4, 5] : partial ? [1, 2] : [],
        version: 1,
        primaryGoal: complete || partial ? FitnessGoal.GAIN_MUSCLE : null,
        experienceLevel: complete ? "INTERMEDIATE" : null,
        weeklyFrequency: complete ? 4 : null,
        trainingLocation: complete ? "GYM" : null,
        availableEquipment: complete ? ["DUMBBELLS", "BARBELL"] : [],
        trainingPreferences: complete ? ["STRENGTH"] : [],
        physicalConsiderations: null,
        weightUnit: "KG",
        heightUnit: "CM",
        heightValue: complete || partial ? 175 : null,
        consentHealth: complete,
        consentData: complete,
        startedAt: partial || complete ? new Date() : null,
        completedAt: complete ? new Date() : null,
      },
      transaction,
    });
    await onboarding.update({ status: scenario.onboarding }, { transaction });
    if (complete || partial) {
      await BodyMeasurementModel.findOrCreate({
        where: { userId: user.id, idempotencyKey: "mock-initial-weight" },
        defaults: {
          userId: user.id,
          weight: 75,
          unit: "KG",
          measuredOn: dateOffset(-1),
          source: "ONBOARDING",
          createdByUserId: user.id,
          idempotencyKey: "mock-initial-weight",
        },
        transaction,
      });
    }
    if (complete)
      await AnthropometricProfileModel.findOrCreate({
        where: { userId: user.id },
        defaults: {
          userId: user.id,
          weightKg: 75,
          heightCm: 175,
          goal: TrainingGoal.HYPERTROPHY,
          measurementUpdatedAt: new Date(),
        },
        transaction,
      });
  }
}
