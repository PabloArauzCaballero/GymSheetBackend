import {
  PROFILE_COMPLETION_ITEMS,
  PROFILE_COMPLETION_TOTAL_POINTS,
  ProfileAward,
  ProfileFacts,
  ProfileItemDefinition,
  buildProfileCompletionView,
  hasMeaningfulBio,
  pendingAwards,
} from "./profile-completion";
import { ProfileCompletionRepository } from "./profile-completion.repository";
import { ProfileCompletionService } from "./profile-completion.service";

const EMPTY: ProfileFacts = {
  hasBodyProfile: false,
  hasBirthDate: false,
  photoCount: 0,
  hasBio: false,
  hasGender: false,
  hasExperienceLevel: false,
  interestCount: 0,
};

const FULL: ProfileFacts = {
  hasBodyProfile: true,
  hasBirthDate: true,
  photoCount: 3,
  hasBio: true,
  hasGender: true,
  hasExperienceLevel: true,
  interestCount: 2,
};

/** In-memory ledger with the same contract as the table: one row per (user, item). */
class FakeRepository {
  facts: ProfileFacts = EMPTY;
  rows: (ProfileAward & { tenantId: string | null })[] = [];

  loadFacts = jest.fn(async () => this.facts);
  listAwards = jest.fn(async () => this.rows.map(({ itemCode, points, awardedAt }) => ({ itemCode, points, awardedAt })));
  award = jest.fn(async (_userId: string, tenantId: string | null, items: readonly ProfileItemDefinition[]) => {
    const fresh = items.filter((item) => !this.rows.some((row) => row.itemCode === item.code));
    for (const item of fresh) this.rows.push({ itemCode: item.code, points: item.points, awardedAt: new Date(), tenantId });
    return fresh.map((item) => item.code);
  });
}

function serviceWith(repository: FakeRepository) {
  return new ProfileCompletionService(repository as unknown as ProfileCompletionRepository);
}

describe("profile completion catalog", () => {
  it("is worth less than two ordinary sessions, so it is not a shortcut to a rank", () => {
    expect(PROFILE_COMPLETION_TOTAL_POINTS).toBe(250);
    expect(PROFILE_COMPLETION_TOTAL_POINTS).toBeLessThan(2 * 150);
  });

  it("has unique codes and positive points", () => {
    const codes = PROFILE_COMPLETION_ITEMS.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(PROFILE_COMPLETION_ITEMS.every((item) => item.points > 0)).toBe(true);
  });

  it("reports what is missing and what it is still worth", () => {
    const view = buildProfileCompletionView({ ...EMPTY, photoCount: 1, hasGender: true }, []);
    expect(view.completed).toBe(2);
    expect(view.percent).toBe(25);
    expect(view.pointsEarned).toBe(0);
    expect(view.pointsAvailable).toBe(250);
    expect(view.items.find((item) => item.code === "FOTO")).toMatchObject({ done: true, awarded: false, points: 50 });
    expect(view.items.find((item) => item.code === "FOTOS_3")).toMatchObject({ done: false });
  });

  it("never announces 100 % before every item is done", () => {
    expect(buildProfileCompletionView({ ...FULL, hasGender: false }, []).percent).toBe(87);
    expect(buildProfileCompletionView(FULL, []).percent).toBe(100);
  });

  it("only proposes items that are done and not yet in the ledger", () => {
    const pending = pendingAwards({ ...EMPTY, photoCount: 3 }, [{ itemCode: "FOTO" }]);
    expect(pending.map((item) => item.code)).toEqual(["FOTOS_3"]);
  });
});

describe("hasMeaningfulBio", () => {
  it.each([
    ["null", null],
    ["blank", "   "],
    ["two letters", "Yo"],
    ["emoji only", "💪💪💪"],
    ["punctuation", "..."],
    ["zero-width spaces", "\u200B\u200B\u200B"],
    ["RTL override around two letters", "\u202Eab"],
    ["Hangul fillers (letters for Unicode)", "\u3164\u3164\u3164"],
    ["Hangul choseong/jungseong fillers", "\u115F\u1160\u115F"],
    ["halfwidth Hangul fillers", "\uFFA0\uFFA0\uFFA0"],
  ])("does not pay for a bio without real content (%s)", (_name, bio) => {
    expect(hasMeaningfulBio(bio)).toBe(false);
  });

  it.each([["Spanish", "Sí, yo"], ["digits", "5x5"], ["Cyrillic", "Бег"], ["Japanese", "走ります"], ["Korean", "운동해"]])(
    "pays for three letters or digits in any script (%s)",
    (_name, bio) => {
      expect(hasMeaningfulBio(bio)).toBe(true);
    },
  );
});

describe("ProfileCompletionService", () => {
  it("previews earned plus pending points without writing anything", async () => {
    const repository = new FakeRepository();
    repository.rows = [{ itemCode: "BIO", points: 40, awardedAt: new Date(), tenantId: null }];
    repository.facts = { ...EMPTY, photoCount: 1, hasBio: true };

    await expect(serviceWith(repository).preview("user-1")).resolves.toBe(90);
    expect(repository.award).not.toHaveBeenCalled();
    expect(repository.rows).toHaveLength(1);
  });

  it("shows grandfathered items (0 points) as done and not pending", () => {
    const view = buildProfileCompletionView({ ...EMPTY, photoCount: 1 }, [
      { itemCode: "FOTO", points: 0, awardedAt: new Date() },
    ]);
    expect(view.items.find((item) => item.code === "FOTO")).toMatchObject({ done: true, awarded: true, points: 0 });
    expect(view.pointsEarned).toBe(0);
    expect(view.pointsAvailable).toBe(200);
  });

  it("awards each completed item once and adds it to the earned points", async () => {
    const repository = new FakeRepository();
    repository.facts = { ...EMPTY, photoCount: 1, hasBio: true };
    const first = await serviceWith(repository).sync("user-1", "repp");

    expect(first.awardedNow.sort()).toEqual(["BIO", "FOTO"]);
    expect(first.pointsEarned).toBe(90);
    expect(repository.rows.every((row) => row.tenantId === "repp")).toBe(true);
  });

  it("is idempotent: a second read awards nothing and the total does not move", async () => {
    const repository = new FakeRepository();
    repository.facts = FULL;
    const service = serviceWith(repository);
    const first = await service.sync("user-1", null);
    const second = await service.sync("user-1", null);

    expect(first.pointsEarned).toBe(250);
    expect(second.awardedNow).toEqual([]);
    expect(second.pointsEarned).toBe(250);
    expect(repository.rows).toHaveLength(PROFILE_COMPLETION_ITEMS.length);
  });

  it("keeps the points when a datum is removed later, and does not pay twice when it comes back", async () => {
    const repository = new FakeRepository();
    const service = serviceWith(repository);
    repository.facts = { ...EMPTY, photoCount: 1 };
    await service.sync("user-1", null);

    repository.facts = EMPTY;
    const removed = await service.sync("user-1", null);
    expect(removed.pointsEarned).toBe(50);
    expect(removed.items.find((item) => item.code === "FOTO")).toMatchObject({ done: false, awarded: true });
    expect(removed.pointsAvailable).toBe(200);

    repository.facts = { ...EMPTY, photoCount: 1 };
    const back = await service.sync("user-1", null);
    expect(back.awardedNow).toEqual([]);
    expect(back.pointsEarned).toBe(50);
  });

  it("pays what the item was worth when earned, even if the catalog changes later", async () => {
    const repository = new FakeRepository();
    repository.rows = [{ itemCode: "FOTO", points: 80, awardedAt: new Date("2026-01-01"), tenantId: null }];
    repository.facts = { ...EMPTY, photoCount: 1 };
    const view = await serviceWith(repository).sync("user-1", null);

    expect(view.pointsEarned).toBe(80);
    expect(view.items.find((item) => item.code === "FOTO")?.points).toBe(80);
  });

  it("does not write when nothing is pending", async () => {
    const repository = new FakeRepository();
    await serviceWith(repository).sync("user-1", null);
    expect(repository.award).toHaveBeenCalledWith("user-1", null, []);
    expect(repository.rows).toEqual([]);
  });
});
