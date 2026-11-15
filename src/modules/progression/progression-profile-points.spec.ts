import type { UsersRepository } from "../users/users.repository";
import type { PrizesRepository } from "./prizes.repository";
import { ProfileAward, ProfileFacts, ProfileItemDefinition } from "./profile-completion";
import type { ProfileCompletionRepository } from "./profile-completion.repository";
import { ProfileCompletionService } from "./profile-completion.service";
import type { ProgressionRepository, TrainingMetrics } from "./progression.repository";
import { ProgressionService } from "./progression.service";
import type { WeeklyChallengesService } from "./weekly-challenges.service";

const NO_TRAINING: TrainingMetrics = {
  totalSessions: 0,
  totalSets: 0,
  totalReps: 0,
  totalVolumeKg: 0,
  maxSessionVolumeKg: 0,
  distinctExercises: 0,
  distinctMuscleGroups: 0,
  earlySessions: 0,
  nightSessions: 0,
  weekendSessions: 0,
  personalRecords: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  weeklyStreak: 0,
  lastSessionOn: null,
  firstSessionOn: null,
};

const ONE_SESSION: TrainingMetrics = {
  ...NO_TRAINING,
  totalSessions: 1,
  totalSets: 3,
  totalReps: 30,
  totalVolumeKg: 900,
  currentStreakDays: 1,
  longestStreakDays: 1,
  lastSessionOn: "2026-11-15",
  firstSessionOn: "2026-11-15",
};

/** A photo is on the profile but no read has paid it yet. */
const PHOTO_PENDING: ProfileFacts = {
  hasBodyProfile: false,
  hasBirthDate: false,
  photoCount: 1,
  hasBio: false,
  hasGender: false,
  hasExperienceLevel: false,
  interestCount: 0,
};

class FakeLedger {
  facts: ProfileFacts = PHOTO_PENDING;
  rows: ProfileAward[] = [];
  loadFacts = jest.fn(async () => this.facts);
  listAwards = jest.fn(async () => [...this.rows]);
  award = jest.fn(async (_userId: string, _tenantId: string | null, items: readonly ProfileItemDefinition[]) => {
    const fresh = items.filter((item) => !this.rows.some((row) => row.itemCode === item.code));
    this.rows.push(...fresh.map((item) => ({ itemCode: item.code, points: item.points, awardedAt: new Date() })));
    return fresh.map((item) => item.code);
  });
}

function build() {
  const ledger = new FakeLedger();
  const state = { metrics: NO_TRAINING };
  const challengeState = {
    view: { weekStart: "2026-11-09", items: [], perfect: false },
    totals: { completed: 0, perfectWeeks: 0, points: 0, perfectWeekStarts: [] },
  };
  const progressionRepository = {
    computeMetrics: jest.fn(async () => state.metrics),
    listLevels: jest.fn(async () => []),
    listBadges: jest.fn(async () => []),
    listUserBadges: jest.fn(async () => []),
    awardBadges: jest.fn(),
    syncStrikeLedger: jest.fn(),
    findProgress: jest.fn(async () => null),
    saveProgress: jest.fn(),
  };
  const service = new ProgressionService(
    progressionRepository as unknown as ProgressionRepository,
    { findById: jest.fn(async () => ({ id: "user-1", gender: null, tenantId: "repp" })) } as unknown as UsersRepository,
    {
      sync: jest.fn(async () => challengeState),
      preview: jest.fn(async () => challengeState),
    } as unknown as WeeklyChallengesService,
    {
      listActiveFor: jest.fn(async () => []),
      listCoupons: jest.fn(async () => []),
    } as unknown as PrizesRepository,
    new ProfileCompletionService(ledger as unknown as ProfileCompletionRepository),
  );
  return { service, ledger, state, progressionRepository };
}

describe("ProgressionService and profile-completion points", () => {
  it("does not credit a session with profile points it did not earn", async () => {
    const { service, ledger, state } = build();
    const before = await service.snapshot("user-1");
    expect(ledger.award).not.toHaveBeenCalled();

    state.metrics = ONE_SESSION;
    const reward = await service.recordSessionReward("user-1", before);

    // The session close paid the pending photo (50) through sync()...
    expect(ledger.rows.map((row) => row.itemCode)).toEqual(["FOTO"]);
    expect(reward.pointsAfter - reward.pointsBefore).toBe(reward.pointsEarned);
    // ...but it is not the session's merit: no profile delta, and the rows add up.
    expect(reward.breakdown.profile).toBe(0);
    const { penalties, strikePurchases, ...earned } = reward.breakdown;
    const sum = Object.values(earned).reduce((total, value) => total + value, 0) - penalties - strikePurchases;
    expect(sum).toBe(reward.pointsEarned);
  });

  it("saves the recomputed senda when reading the profile completion pays something", async () => {
    const { service, progressionRepository } = build();
    const view = await service.getProfileCompletion("user-1");

    expect(view.awardedNow).toEqual(["FOTO"]);
    expect(progressionRepository.saveProgress).toHaveBeenCalledTimes(1);
    expect(progressionRepository.saveProgress).toHaveBeenCalledWith("user-1", expect.objectContaining({ points: 50 }));
  });

  it("does not recompute the senda when the read pays nothing", async () => {
    const { service, ledger, progressionRepository } = build();
    ledger.facts = { ...PHOTO_PENDING, photoCount: 0 };
    const view = await service.getProfileCompletion("user-1");

    expect(view.awardedNow).toEqual([]);
    expect(progressionRepository.saveProgress).not.toHaveBeenCalled();
  });
});
