import { DomainException } from "../../common/errors/domain.exception";
import { mapMyGym } from "./my-gym.mapper";
import { LiveSocioRow, MyGymRepository } from "./my-gym.repository";
import { MyGymService } from "./my-gym.service";

const row = (patch: Partial<LiveSocioRow>): LiveSocioRow => ({
  affiliationId: "a-1",
  status: "CONFIRMED",
  requestedAt: new Date("2026-11-01T10:00:00Z"),
  confirmedAt: new Date("2026-11-02T10:00:00Z"),
  replacesAffiliationId: null,
  gymId: "g-1",
  gymName: "Gimnasio Uno",
  gymHandle: "uno",
  gymLogoUrl: null,
  locationId: "l-1",
  locationName: "Centro",
  ...patch,
});

function serviceWith(rows: LiveSocioRow[], confirmedGym: string | null) {
  const repository = {
    liveSocio: jest.fn().mockResolvedValue(rows),
    membershipVisible: jest.fn().mockResolvedValue(true),
    confirmedGymOf: jest.fn().mockResolvedValue(confirmedGym),
    leaderboard: jest.fn().mockResolvedValue([]),
  } as unknown as MyGymRepository;
  return { service: new MyGymService(repository), repository };
}

describe("«Mi gimnasio» state (ADR-0027)", () => {
  it("NONE without a live SOCIO; REQUESTED keeps the gym out and shows the request", () => {
    expect(mapMyGym([], true)).toMatchObject({ status: "NONE", gym: null, pendingRequest: null, membershipVisible: true });
    const requested = mapMyGym([row({ status: "REQUESTED", confirmedAt: null })], false);
    expect(requested).toMatchObject({ status: "REQUESTED", gym: null, since: null, affiliationId: null, membershipVisible: false });
    expect(requested.pendingRequest).toEqual({
      affiliationId: "a-1",
      gym: { id: "g-1", name: "Gimnasio Uno", handle: "uno", logoUrl: null },
      location: { id: "l-1", name: "Centro" },
      requestedAt: "2026-11-01T10:00:00.000Z",
      switchesGym: false,
    });
  });

  it("CONFIRMED with a gym switch pending shows both", () => {
    const state = mapMyGym(
      [row({}), row({ affiliationId: "a-2", status: "REQUESTED", confirmedAt: null, gymId: "g-2", replacesAffiliationId: "a-1" })],
      true,
    );
    expect(state).toMatchObject({ status: "CONFIRMED", gym: { id: "g-1" }, since: "2026-11-02T10:00:00.000Z", affiliationId: "a-1" });
    expect(state.pendingRequest).toMatchObject({ affiliationId: "a-2", gym: { id: "g-2" }, switchesGym: true });
  });

  it("gym surfaces need a CONFIRMED SOCIO: 403 GYM_MEMBERSHIP_REQUIRED with the current status otherwise", async () => {
    await expect(serviceWith([], "g-1").service.requireConfirmedGym("u")).resolves.toBe("g-1");
    for (const [rows, status] of [[[], "NONE"], [[row({ status: "REQUESTED", confirmedAt: null })], "REQUESTED"]] as const) {
      const { service, repository } = serviceWith([...rows], null);
      const error = await service.leaderboard("u", 10, "points").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).getStatus()).toBe(403);
      expect((error as DomainException).code).toBe("GYM_MEMBERSHIP_REQUIRED");
      expect((error as DomainException).details).toEqual({ status });
      expect(repository.leaderboard).not.toHaveBeenCalled();
    }
  });
});
