import type { ChatEventsService } from "../chat/chat-events.service";
import type { UsersRepository } from "../users/users.repository";
import type { RecommendationsClient } from "./recommendations-client";
import { mapPublicAbout, type PublicAboutRow } from "./social-profile.mapper";
import { mapDirectoryRowToResponse, mapMemberProfileToResponse } from "./social.mapper";
import type { DirectoryRow, SocialRepository } from "./social.repository";
import { SocialService } from "./social.service";

const viewerId = "00000000-0000-4000-8000-0000000000b1";
const hiddenId = "00000000-0000-4000-8000-0000000000b2";
const visibleId = "00000000-0000-4000-8000-0000000000b3";

const about = (overrides: Partial<PublicAboutRow> = {}): PublicAboutRow => ({
  interests: ["RUNNING", "MUSIC"],
  drinking: "SOCIALLY",
  smoking: "NEVER",
  pets: "CAT",
  bio: "Busco compañero para pierna.",
  orientation: "GAY",
  orientationVisible: false,
  ...overrides,
});

const row = (userId: string, details: PublicAboutRow | null): DirectoryRow => ({
  userId,
  fullName: "Ana María Pérez",
  objetivo: "FUERZA",
  branchId: null,
  branchName: null,
  connectionStatus: "NONE",
  connectionId: null,
  socialStatus: null,
  photoUrl: null,
  photos: [],
  age: 30,
  gender: "FEMALE",
  experienceLevel: null,
  points: 10,
  levelCode: null,
  recommendationArea: { lat: -17.78, lon: -63.18 },
  recommendationIntents: ["TRAINING"],
  about: details,
});

describe("public profile exposure rules", () => {
  it("omits the orientation key entirely while it is hidden", () => {
    const mapped = mapPublicAbout(about());
    expect(mapped).not.toHaveProperty("orientation");
    expect(mapped).toEqual({
      interests: ["RUNNING", "MUSIC"],
      drinking: "SOCIALLY",
      smoking: "NEVER",
      pets: "CAT",
      bio: "Busco compañero para pierna.",
    });
  });

  it("shows the orientation only after its owner turns visibility on", () => {
    expect(mapPublicAbout(about({ orientationVisible: true })).orientation).toBe("GAY");
    expect(mapPublicAbout(about({ orientationVisible: true, orientation: null })))
      .not.toHaveProperty("orientation");
  });

  it("gives members without answers an empty about block", () => {
    expect(mapPublicAbout(null)).toEqual({
      interests: [],
      drinking: null,
      smoking: null,
      pets: null,
      bio: null,
    });
  });

  it("applies the rule to directory entries and member profiles", () => {
    const entry = mapDirectoryRowToResponse(row(hiddenId, about()));
    expect(entry.about).not.toHaveProperty("orientation");
    expect(JSON.stringify(entry)).not.toContain("GAY");
    expect(JSON.stringify(entry)).not.toContain("orientationVisible");
    const profile = mapMemberProfileToResponse(row(visibleId, about({ orientationVisible: true })), []);
    expect(profile.about.orientation).toBe("GAY");
  });

  it("keeps profile answers out of the recommender payload and hides orientation on deck cards", async () => {
    const rows = [
      row(hiddenId, about()),
      row(visibleId, about({ orientation: "LESBIAN", orientationVisible: true })),
    ];
    const rankPeople = jest.fn().mockResolvedValue({
      candidates: [
        { profileId: hiddenId, score: 2, reasonCodes: [] },
        { profileId: visibleId, score: 1, reasonCodes: [] },
      ],
      nextCursor: null,
    });
    const service = new SocialService(
      {
        discoveryPreferences: jest.fn().mockResolvedValue({
          configured: true,
          genders: ["FEMALE"],
          intents: ["UNSURE"],
          minAge: 18,
          maxAge: 50,
          radiusKm: 25,
          flexibleAge: false,
          flexibleDistance: false,
          version: 1,
        }),
        discoverySettings: jest.fn().mockResolvedValue({
          profileEnabled: true,
          crossGymEnabled: false,
          mapEnabled: false,
          version: 1,
        }),
        discoveryViewerContext: jest.fn().mockResolvedValue({
          age: 30,
          gender: "MALE",
          goal: null,
          area: { lat: -17.78, lon: -63.18 },
        }),
        directory: jest.fn().mockResolvedValue(rows),
      } as unknown as SocialRepository,
      {} as UsersRepository,
      {} as ChatEventsService,
      { rankPeople } as unknown as RecommendationsClient,
    );

    const page = await service.discoveryDeckPage(viewerId, "tenant", { limit: 10 });

    const payload = JSON.stringify(rankPeople.mock.calls[0][0]);
    for (const leaked of ["GAY", "LESBIAN", "orientation", "bio", "SOCIALLY", "CAT", "MUSIC"]) {
      expect(payload).not.toContain(leaked);
    }
    expect(rankPeople.mock.calls[0][0].viewer.intents).toEqual(["UNSURE"]);
    const byId = new Map(page.items.map((item) => [item.userId, item]));
    expect(byId.get(hiddenId)?.about).not.toHaveProperty("orientation");
    expect(byId.get(hiddenId)?.about.interests).toEqual(["RUNNING", "MUSIC"]);
    expect(byId.get(visibleId)?.about.orientation).toBe("LESBIAN");
  });
});
