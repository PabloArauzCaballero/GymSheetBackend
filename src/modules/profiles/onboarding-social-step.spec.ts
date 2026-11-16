import type { Sequelize } from "sequelize-typescript";
import { OnboardingStatus } from "../../common/enums/domain.enums";
import type { OnboardingRepository } from "./onboarding.repository";
import { onboardingSocialStepSchema } from "./onboarding.schemas";
import { OnboardingService } from "./onboarding.service";

type SocialStep = "PENDING" | "DONE" | "SKIPPED";

function fakeState(socialStep: SocialStep) {
  const values: Record<string, unknown> & { socialStep: SocialStep } = {
    userId: "u1",
    status: OnboardingStatus.IN_PROGRESS,
    currentStep: 2,
    completedSteps: [1],
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
    socialStep,
  };
  const update = jest.fn((changes: { socialStep: SocialStep }) => {
    Object.assign(values, changes);
    return Promise.resolve();
  });
  return Object.assign(values, { update });
}

function serviceFor(state: ReturnType<typeof fakeState>) {
  const repository = { getOrCreate: jest.fn().mockResolvedValue(state) };
  return new OnboardingService(
    repository as unknown as OnboardingRepository,
    {} as Sequelize,
  );
}

describe("onboarding social step", () => {
  it("accepts only DONE and SKIP", () => {
    expect(onboardingSocialStepSchema.safeParse({ action: "DONE" }).success).toBe(true);
    expect(onboardingSocialStepSchema.safeParse({ action: "SKIP" }).success).toBe(true);
    expect(onboardingSocialStepSchema.safeParse({ action: "PENDING" }).success).toBe(false);
    expect(onboardingSocialStepSchema.safeParse({}).success).toBe(false);
  });

  it("starts PENDING and is exposed in the onboarding state", async () => {
    await expect(serviceFor(fakeState("PENDING")).getState("u1")).resolves.toMatchObject({
      socialStep: "PENDING",
    });
  });

  it("can be skipped and resumed later without touching the main status", async () => {
    const state = fakeState("PENDING");
    const service = serviceFor(state);
    await expect(service.saveSocialStep("u1", { action: "SKIP" })).resolves.toMatchObject({
      socialStep: "SKIPPED",
      status: OnboardingStatus.IN_PROGRESS,
      currentStep: 2,
    });
    await expect(service.saveSocialStep("u1", { action: "DONE" })).resolves.toMatchObject({
      socialStep: "DONE",
      status: OnboardingStatus.IN_PROGRESS,
    });
  });

  it("never downgrades a finished step when SKIP arrives late", async () => {
    const state = fakeState("DONE");
    const service = serviceFor(state);
    await expect(service.saveSocialStep("u1", { action: "SKIP" })).resolves.toMatchObject({
      socialStep: "DONE",
    });
    expect(state.update).not.toHaveBeenCalled();
  });
});
