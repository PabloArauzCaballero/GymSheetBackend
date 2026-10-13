import { z } from "zod";

const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function dateTimeParts(value: string) {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number((match[7] ?? "").padEnd(3, "0") || "0"),
    offsetHour: Number(match[10] ?? "0"),
    offsetMinute: Number(match[11] ?? "0"),
    offset: match[8],
  };
}

function hasValidCalendarDate(value: string): boolean {
  const parts = dateTimeParts(value);
  if (!parts || parts.year === 0) return false;
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return false;
  if (parts.offsetHour > 14 || parts.offsetMinute > 59) return false;
  if (parts.offsetHour === 14 && parts.offsetMinute !== 0) return false;
  if (parts.offset === "-00:00" || !Number.isFinite(Date.parse(value)))
    return false;

  const calendar = new Date(0);
  calendar.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  calendar.setUTCHours(
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return (
    calendar.getUTCFullYear() === parts.year &&
    calendar.getUTCMonth() === parts.month - 1 &&
    calendar.getUTCDate() === parts.day &&
    calendar.getUTCHours() === parts.hour &&
    calendar.getUTCMinutes() === parts.minute &&
    calendar.getUTCSeconds() === parts.second &&
    calendar.getUTCMilliseconds() === parts.millisecond
  );
}

function matchesTimeZone(value: string, timeZone: string): boolean {
  const expected = dateTimeParts(value);
  if (!expected) return false;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(Date.parse(value)))
        .map(({ type, value: partValue }) => [type, partValue]),
    );
    return (
      Number(parts.year) === expected.year &&
      Number(parts.month) === expected.month &&
      Number(parts.day) === expected.day &&
      Number(parts.hour) === expected.hour &&
      Number(parts.minute) === expected.minute &&
      Number(parts.second) === expected.second &&
      Number(parts.fractionalSecond) === expected.millisecond
    );
  } catch {
    return false;
  }
}

const offsetDateTime = z
  .string()
  .trim()
  .regex(DATE_TIME_PATTERN, "startsAt debe ser RFC 3339 con offset explícito.")
  .refine(hasValidCalendarDate, {
    message: "startsAt debe contener una fecha de calendario y offset válidos.",
  });

const place = z
  .object({
    kind: z.enum(["GYM", "PUBLIC_PLACE"]),
    placeId: z.string().uuid().optional(),
    label: z.string().trim().min(2).max(180),
  })
  .strict()
  .refine((value) => value.kind !== "GYM" || Boolean(value.placeId), {
    message: "Un gimnasio requiere placeId.",
    path: ["placeId"],
  });

export const createTrainingInviteSchema = z
  .object({
    recipientId: z.string().uuid(),
    startsAt: offsetDateTime,
    timeZone: z.string().trim().min(1).max(80),
    durationMinutes: z.number().int().min(15).max(360).default(60),
    place,
    mode: z.enum(["OWN_ROUTINES", "SHARED_SESSION"]).default("OWN_ROUTINES"),
    routineSessionId: z.string().uuid().optional(),
    note: z.string().trim().max(1000).optional(),
    clientRequestId: z.string().uuid(),
  })
  .strict()
  .refine(
    (value) =>
      value.mode !== "SHARED_SESSION" || Boolean(value.routineSessionId),
    {
      message: "SHARED_SESSION requiere routineSessionId.",
      path: ["routineSessionId"],
    },
  )
  .refine((value) => matchesTimeZone(value.startsAt, value.timeZone), {
    message: "El offset de startsAt debe corresponder con timeZone.",
    path: ["startsAt"],
  });

export type CreateTrainingInviteInput = z.infer<
  typeof createTrainingInviteSchema
>;

export const respondTrainingInviteSchema = z
  .object({
    decision: z.enum(["ACCEPT", "DECLINE"]),
    expectedRevision: z.number().int().positive(),
    clientRequestId: z.string().uuid(),
  })
  .strict();

export type RespondTrainingInviteInput = z.infer<
  typeof respondTrainingInviteSchema
>;

export const counterproposeTrainingInviteSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    clientRequestId: z.string().uuid(),
    startsAt: offsetDateTime,
    timeZone: z.string().trim().min(1).max(80),
    durationMinutes: z.number().int().min(15).max(360).default(60),
    place,
    mode: z.enum(["OWN_ROUTINES", "SHARED_SESSION"]).default("OWN_ROUTINES"),
    routineSessionId: z.string().uuid().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.mode !== "SHARED_SESSION" || Boolean(value.routineSessionId),
    {
      message: "SHARED_SESSION requiere routineSessionId.",
      path: ["routineSessionId"],
    },
  )
  .refine((value) => matchesTimeZone(value.startsAt, value.timeZone), {
    message: "El offset de startsAt debe corresponder con timeZone.",
    path: ["startsAt"],
  });

export type CounterproposeTrainingInviteInput = z.infer<
  typeof counterproposeTrainingInviteSchema
>;
