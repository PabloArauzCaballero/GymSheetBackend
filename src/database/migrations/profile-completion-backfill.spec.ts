import { stripInvisibleCharacters } from "../../common/text/invisible-characters";
import { PROFILE_COMPLETION_ITEMS, ProfileFacts, hasMeaningfulBio } from "../../modules/progression/profile-completion";
import {
  FROZEN_PROFILE_ITEMS,
  frozenHasMeaningfulBio,
  frozenStripInvisible,
} from "./profile-completion-backfill.snapshot";

/**
 * The 202611150005 backfill uses a frozen copy of the profile predicates. If the
 * live service changes what counts as "done", this fails: then decide whether
 * the change is intended (and leave the snapshot as history) or a mistake.
 */
function everyFacts(): ProfileFacts[] {
  const all: ProfileFacts[] = [];
  for (let flags = 0; flags < 32; flags += 1) {
    for (const photoCount of [0, 1, 2, 3, 4]) {
      for (const interestCount of [0, 1, 2]) {
        all.push({
          hasBodyProfile: Boolean(flags & 1),
          hasBirthDate: Boolean(flags & 2),
          hasBio: Boolean(flags & 4),
          hasGender: Boolean(flags & 8),
          hasExperienceLevel: Boolean(flags & 16),
          photoCount,
          interestCount,
        });
      }
    }
  }
  return all;
}

const BIOS = [
  null,
  "",
  "   ",
  "Yo",
  "Yo!",
  "abc",
  "5x5",
  "💪💪💪",
  "...",
  "​​​",
  "‮ab",
  "‮abc",
  "ㅤㅤㅤ",
  "ᅟᅠᅟ",
  "ﾠﾠﾠ",
  "⠀⠀⠀",
  "a‍b‍c",
  "Бег",
  "走ります",
  "운동해",
  "\u{1F468}‍\u{1F469}‍\u{1F467} ok",
  "Pier­na",
];

describe("profile-completion backfill snapshot parity", () => {
  it("has the same eight item codes as the live catalog", () => {
    expect(FROZEN_PROFILE_ITEMS.map((item) => item.code)).toEqual(PROFILE_COMPLETION_ITEMS.map((item) => item.code));
  });

  it("judges every combination of profile facts exactly like the live catalog", () => {
    const frozenByCode = new Map(FROZEN_PROFILE_ITEMS.map((item) => [item.code, item]));
    const drift = everyFacts().flatMap((facts) =>
      PROFILE_COMPLETION_ITEMS.filter((item) => item.done(facts) !== frozenByCode.get(item.code)?.done(facts)).map(
        (item) => ({ code: item.code, facts }),
      ),
    );
    expect(drift).toEqual([]);
  });

  it.each(BIOS)("judges the bio %j like the live predicate and sanitiser", (bio) => {
    expect(frozenHasMeaningfulBio(bio)).toBe(hasMeaningfulBio(bio));
    if (bio !== null) expect(frozenStripInvisible(bio)).toBe(stripInvisibleCharacters(bio));
  });
});
