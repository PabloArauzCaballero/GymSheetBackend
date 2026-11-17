import { resolveMediaUrl } from "../../common/media/media-url";
import { shortenName } from "../social/social.mapper";
import { LeaderboardRow, LiveSocioRow } from "./my-gym.repository";

export type MyGymStatus = "NONE" | "REQUESTED" | "CONFIRMED";

export type GymCard = { id: string; name: string; handle: string | null; logoUrl: string | null };

/** «Mi gimnasio» as the person's own card and tab read it (ADR-0027). */
export type MyGymResponse = {
  status: MyGymStatus;
  /** The confirmed gym; null unless `status` is CONFIRMED. */
  gym: GymCard | null;
  location: { id: string; name: string } | null;
  /** When the gym confirmed the membership. */
  since: string | null;
  affiliationId: string | null;
  /** The pending SOCIO request («Solicitud enviada»): the first one, or a gym switch. */
  pendingRequest: {
    affiliationId: string;
    gym: GymCard;
    location: { id: string; name: string } | null;
    requestedAt: string;
    switchesGym: boolean;
  } | null;
  /** Whether others see the badge, the person in the member list and in the ranking. */
  membershipVisible: boolean;
};

const gymCard = (row: LiveSocioRow): GymCard => ({
  id: row.gymId,
  name: row.gymName,
  handle: row.gymHandle,
  logoUrl: resolveMediaUrl(row.gymLogoUrl),
});

const locationOf = (row: LiveSocioRow) => (row.locationId && row.locationName ? { id: row.locationId, name: row.locationName } : null);

export function mapMyGym(rows: readonly LiveSocioRow[], membershipVisible: boolean): MyGymResponse {
  const confirmed = rows.find((row) => row.status === "CONFIRMED") ?? null;
  const requested = rows.find((row) => row.status === "REQUESTED") ?? null;
  return {
    status: confirmed ? "CONFIRMED" : requested ? "REQUESTED" : "NONE",
    gym: confirmed ? gymCard(confirmed) : null,
    location: confirmed ? locationOf(confirmed) : null,
    since: confirmed?.confirmedAt ? new Date(confirmed.confirmedAt).toISOString() : null,
    affiliationId: confirmed?.affiliationId ?? null,
    pendingRequest: requested
      ? {
          affiliationId: requested.affiliationId,
          gym: gymCard(requested),
          location: locationOf(requested),
          requestedAt: new Date(requested.requestedAt).toISOString(),
          switchesGym: requested.replacesAffiliationId !== null,
        }
      : null,
    membershipVisible,
  };
}

/** One row of the gym ranking: first name and initial only (a member list of the gym is not public). */
export function mapLeaderboard(rows: readonly LeaderboardRow[], viewerId: string) {
  return rows.map((row, index) => ({
    position: index + 1,
    userId: row.userId,
    points: Number(row.points),
    levelCode: row.levelCode,
    streakDays: Number(row.currentStreakDays),
    displayName: shortenName(row.fullName),
    photoUrl: resolveMediaUrl(row.photoUrl),
    badges: Array.isArray(row.badges) ? row.badges : [],
    isMe: row.userId === viewerId,
  }));
}
