import type { Sequelize } from "sequelize-typescript";
import { OnboardingStatus } from "../../common/enums/domain.enums";
import type { ConsentsService } from "../consents/consents.service";
import { CONSENT_VERSIONS } from "../legal/consent-versions";
import type { OnboardingRepository } from "./onboarding.repository";
import { OnboardingService } from "./onboarding.service";

function setup(stored: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    userId: "u1",
    status: OnboardingStatus.IN_PROGRESS,
    currentStep: 3,
    completedSteps: [1, 2],
    version: 1,
    primaryGoal: "GAIN_MUSCLE",
    experienceLevel: "BEGINNER",
    weeklyFrequency: 3,
    trainingLocation: "GYM",
    availableEquipment: [],
    trainingPreferences: [],
    physicalConsiderations: null,
    heightValue: 175,
    consentHealth: false,
    consentData: true,
    startedAt: null,
    completedAt: null,
    socialStep: "PENDING",
    ...stored,
  };
  const update = jest.fn((values: Record<string, unknown>) => {
    Object.assign(state, values);
    return Promise.resolve();
  });
  Object.assign(state, { update });
  const repository = { getOrCreate: jest.fn().mockResolvedValue(state) };
  const sequelize = { transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work({ id: "tx" })) };
  const consents = { grant: jest.fn().mockResolvedValue(undefined), revoke: jest.fn().mockResolvedValue(undefined) };
  const service = new OnboardingService(
    repository as unknown as OnboardingRepository,
    sequelize as unknown as Sequelize,
    consents as unknown as ConsentsService,
  );
  return { service, consents, update, state };
}

const preferences = {
  experienceLevel: "BEGINNER" as const,
  weeklyFrequency: 3,
  trainingLocation: "GYM" as const,
  trainingPreferences: [],
  consentData: true,
};

describe("onboarding health consent", () => {
  it("does not require the health consent to complete when no health data is given", async () => {
    const { service } = setup();
    const result = await service.getState("u1");
    expect(result.missingFields).not.toContain("consentHealth");
  });

  it("still flags legacy health text kept without consent", async () => {
    const { service } = setup({ physicalConsiderations: "rodilla", consentHealth: false });
    expect((await service.getState("u1")).missingFields).toContain("consentHealth");
  });

  it("rejects physical considerations without the health consent (400 CONSENT_REQUIRED)", async () => {
    const { service, consents, update } = setup();
    await expect(
      service.savePreferences("u1", { ...preferences, physicalConsiderations: "rodilla", consentHealth: false }, "WEB"),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED", status: 400 });
    expect(consents.grant).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("records the HEALTH consent with its version in the same transaction as the text", async () => {
    const { service, consents, state } = setup();
    await service.savePreferences(
      "u1",
      { ...preferences, physicalConsiderations: "rodilla", consentHealth: true, consentHealthVersion: CONSENT_VERSIONS.HEALTH },
      "IOS",
    );
    expect(consents.grant).toHaveBeenCalledWith("u1", "HEALTH", CONSENT_VERSIONS.HEALTH, "IOS", { id: "tx" });
    expect(state.physicalConsiderations).toBe("rodilla");
  });

  it("without consent revokes any open grant and keeps no health text", async () => {
    const { service, consents, state } = setup({ physicalConsiderations: "rodilla", consentHealth: true });
    await service.savePreferences("u1", { ...preferences, consentHealth: false }, "WEB");
    expect(consents.revoke).toHaveBeenCalledWith("u1", "HEALTH", { id: "tx" });
    expect(state.physicalConsiderations).toBeNull();
    expect(state.consentHealth).toBe(false);
  });
});
