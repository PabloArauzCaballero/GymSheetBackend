import { Injectable, NotFoundException } from "@nestjs/common";
import { QueryTypes } from "sequelize";
import { Sequelize } from "sequelize-typescript";

type CalendarMeetingRow = {
  starts_at: Date;
  time_zone: string;
  place_label: string;
  duration_minutes: number;
  accepted_revision: number;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  state: "ACCEPTED" | "CANCELLED";
};

function utcCalendarDate(value: Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** RFC 5545 content lines are at most 75 UTF-8 octets, excluding CRLF. */
function foldCalendarLine(value: string): string {
  let result = "";
  let lineLength = 0;
  for (const character of value) {
    const byteLength = Buffer.byteLength(character, "utf8");
    if (lineLength + byteLength > 75) {
      result += "\r\n ";
      lineLength = 1;
    }
    result += character;
    lineLength += byteLength;
  }
  return result;
}

@Injectable()
export class TrainingInvitationCalendarService {
  constructor(private readonly sequelize: Sequelize) {}

  async forParticipant(inviteId: string, userId: string): Promise<string> {
    const rows = await this.sequelize.query<CalendarMeetingRow>(
      `SELECT m.starts_at, m.time_zone, m.place_label, m.accepted_revision,
              m.created_at, m.cancelled_at, r.duration_minutes, i.state, i.updated_at
         FROM training.training_invites i
         JOIN training.training_invite_meetings m ON m.invite_id = i.id
         JOIN training.training_invite_revisions r
           ON r.invite_id = i.id AND r.revision = m.accepted_revision
        WHERE i.id = :inviteId
          AND (i.inviter_id = :userId OR i.recipient_id = :userId)
          AND i.state IN ('ACCEPTED', 'CANCELLED')`,
      { type: QueryTypes.SELECT, replacements: { inviteId, userId } },
    );
    const meeting = rows[0];
    if (!meeting) {
      throw new NotFoundException("Encuentro no encontrado.");
    }

    const startsAt = new Date(meeting.starts_at);
    const endsAt = new Date(startsAt.getTime() + meeting.duration_minutes * 60_000);
    const cancelled = meeting.state === "CANCELLED" || Boolean(meeting.cancelled_at);
    const changedAt = meeting.cancelled_at ?? (cancelled ? meeting.updated_at : meeting.created_at);
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//GymSheet//Training Invitations//ES",
      "CALSCALE:GREGORIAN",
      `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`,
      `X-WR-TIMEZONE:${escapeCalendarText(meeting.time_zone)}`,
      "BEGIN:VEVENT",
      `UID:gymsheet-${inviteId}-${userId}`,
      `DTSTAMP:${utcCalendarDate(changedAt)}`,
      `LAST-MODIFIED:${utcCalendarDate(changedAt)}`,
      `SEQUENCE:${meeting.accepted_revision + (cancelled ? 1 : 0)}`,
      `DTSTART:${utcCalendarDate(startsAt)}`,
      `DTEND:${utcCalendarDate(endsAt)}`,
      "SUMMARY:Entrenar juntos",
      `LOCATION:${escapeCalendarText(meeting.place_label)}`,
      `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
  }
}
