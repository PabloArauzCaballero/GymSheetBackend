import { NotFoundException } from "@nestjs/common";
import { TrainingInvitationCalendarService } from "./calendar.service";

const inviteId = "e0000000-0000-4000-8000-000000000010";
const inviterId = "e0000000-0000-4000-8000-000000000001";
const recipientId = "e0000000-0000-4000-8000-000000000002";

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    starts_at: new Date("2030-05-01T22:30:00.000Z"),
    time_zone: "America/New_York",
    place_label: "Parque, Norte; Entrada\\Oeste\nPunto de encuentro",
    duration_minutes: 60,
    accepted_revision: 2,
    created_at: new Date("2026-10-11T13:00:00.000Z"),
    updated_at: new Date("2026-10-11T13:00:00.000Z"),
    cancelled_at: null,
    state: "ACCEPTED",
    ...overrides,
  };
}

const unfold = (calendar: string) => calendar.replace(/\r\n /g, "");

describe("TrainingInvitationCalendarService", () => {
  it("exports a stable UTC event with participant-specific UID and escaped, folded text", async () => {
    const query = jest.fn().mockResolvedValue([meeting({
      place_label: "Parque, Norte; Entrada\\Oeste\n" + "Á".repeat(50),
    })]);
    const service = new TrainingInvitationCalendarService({ query } as never);

    const first = await service.forParticipant(inviteId, inviterId);
    const replay = await service.forParticipant(inviteId, inviterId);
    const otherParticipant = await service.forParticipant(inviteId, recipientId);

    expect(first).toBe(replay);
    expect(unfold(first)).toContain(`UID:gymsheet-${inviteId}-${inviterId}\r\n`);
    expect(unfold(otherParticipant)).toContain(`UID:gymsheet-${inviteId}-${recipientId}\r\n`);
    expect(first).toContain("DTSTART:20300501T223000Z\r\n");
    expect(first).toContain("DTEND:20300501T233000Z\r\n");
    expect(first).toContain("X-WR-TIMEZONE:America/New_York\r\n");
    expect(first).toContain("STATUS:CONFIRMED\r\n");
    expect(first).toContain("METHOD:PUBLISH\r\n");
    expect(first).toContain("SEQUENCE:2\r\n");
    expect(unfold(first)).toContain("LOCATION:Parque\\, Norte\\; Entrada\\\\Oeste\\n");
    expect(first.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(first.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("(i.inviter_id = :userId OR i.recipient_id = :userId)");
    expect(query.mock.calls[0]?.[1].replacements).toEqual({ inviteId, userId: inviterId });
  });

  it("keeps UID and increments sequence when the meeting is cancelled", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([meeting()])
      .mockResolvedValueOnce([meeting({
        state: "CANCELLED",
        cancelled_at: new Date("2026-10-12T12:00:00.000Z"),
      })]);
    const service = new TrainingInvitationCalendarService({ query } as never);

    const confirmed = await service.forParticipant(inviteId, inviterId);
    const cancelled = await service.forParticipant(inviteId, inviterId);

    expect(unfold(confirmed)).toContain(`UID:gymsheet-${inviteId}-${inviterId}\r\n`);
    expect(unfold(cancelled)).toContain(`UID:gymsheet-${inviteId}-${inviterId}\r\n`);
    expect(cancelled).toContain("STATUS:CANCELLED\r\n");
    expect(cancelled).toContain("METHOD:CANCEL\r\n");
    expect(cancelled).toContain("SEQUENCE:3\r\n");
    expect(cancelled).toContain("DTSTAMP:20261012T120000Z\r\n");
  });

  it("does not reveal a meeting to a non-participant or for an invitation without a meeting", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new TrainingInvitationCalendarService({ query } as never);

    await expect(service.forParticipant(inviteId, "e0000000-0000-4000-8000-000000000003"))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0]?.[1].replacements).toMatchObject({ inviteId });
  });
});
