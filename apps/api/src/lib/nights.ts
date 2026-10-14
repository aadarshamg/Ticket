// Multi-night events. The event settings hold the first night's times and the last night's end;
// every night in between runs at the same times of day. A booking belongs to one night, held as
// an India date ("2026-10-17"); a booking without one is valid on any night.

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Scans after midnight still count as the night before, until 06:00. */
const NIGHT_ROLLOVER_MS = 6 * 60 * 60 * 1000;
const MAX_NIGHTS = 31;

export interface EventTimes {
  startsAt: Date;
  gatesOpenAt: Date;
  endsAt: Date;
}

/** The India date of an instant, as "YYYY-MM-DD". */
export function istDateKey(instant: Date | number): string {
  return new Date(Number(instant) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight at the start of an India date, as an instant. */
function istMidnight(night: string): number {
  return Date.parse(`${night}T00:00:00Z`) - IST_OFFSET_MS;
}

/** Milliseconds since India midnight. */
function istTimeOfDay(instant: Date): number {
  return (((instant.getTime() + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
}

function addDays(night: string, days: number): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Gate, start and end times of one night, at the same times of day as the first night. */
export function nightTimes(event: EventTimes, night: string): EventTimes {
  const startsAt = istMidnight(night) + istTimeOfDay(event.startsAt);
  const gatesOpenAt = startsAt - (event.startsAt.getTime() - event.gatesOpenAt.getTime());
  let endsAt = istMidnight(night) + istTimeOfDay(event.endsAt);
  if (endsAt <= startsAt) endsAt += DAY_MS; // the night runs past midnight
  return { startsAt: new Date(startsAt), gatesOpenAt: new Date(gatesOpenAt), endsAt: new Date(endsAt) };
}

/** Every night of the event, first to last, e.g. ["2026-10-17", "2026-10-18"]. */
export function eventNights(event: EventTimes): string[] {
  const nights: string[] = [];
  let night = istDateKey(event.startsAt);
  while (nights.length < MAX_NIGHTS && nightTimes(event, night).startsAt.getTime() < event.endsAt.getTime()) {
    nights.push(night);
    night = addDays(night, 1);
  }
  return nights.length > 0 ? nights : [istDateKey(event.startsAt)];
}

/**
 * The night the gates are working on now, or null on a day that is not one of the event's
 * nights (before the event, for example while testing), when passes are not checked by night.
 */
export function currentNight(event: EventTimes, now: number = Date.now()): string | null {
  const night = istDateKey(now - NIGHT_ROLLOVER_MS);
  return eventNights(event).includes(night) ? night : null;
}

/** The times a booking's passes are for: its own night, or the whole event when it has none. */
export function bookingTimes(event: EventTimes, night: string | null): EventTimes {
  return night ? nightTimes(event, night) : event;
}

const labelFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "2026-10-18" -> "Sun, 18 Oct" */
export function nightLabel(night: string): string {
  const parts = Object.fromEntries(
    labelFormat.formatToParts(new Date(`${night}T00:00:00Z`)).map((part) => [part.type, part.value]),
  );
  return `${parts.weekday}, ${parts.day} ${parts.month}`;
}

/** Postgres DATE <-> "YYYY-MM-DD". Prisma reads a DATE column as midnight UTC. */
export function nightFromDb(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
export function nightToDb(night: string | null): Date | null {
  return night ? new Date(`${night}T00:00:00Z`) : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/** The event night with this month and day, for dates written without a year. */
function byMonthDay(nights: string[], month: number, day: number): string | null {
  return nights.find((night) => night.slice(5) === `${pad(month)}-${pad(day)}`) ?? null;
}

/**
 * Reads the night a booking is for from a spreadsheet cell. Accepts what booking exports
 * usually contain: 17/10/2026 (day first), 2026-10-17, "17 Oct", "Sat, 17 Oct 2026 7:00 PM",
 * "Oct 17, 2026", an Excel date, a bare day of the month (17) or "Night 2".
 * Returns the night, or an error message when the cell is not one of the event's nights.
 */
export function parseNight(value: unknown, nights: string[]): { night: string } | { error: string } {
  const wrong = { error: `night must be one of the event's nights: ${nights.map(nightLabel).join(' or ')}` };
  const found = (night: string | null) => (night && nights.includes(night) ? { night } : wrong);

  if (value instanceof Date) return found(istDateKey(value));
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1 && value <= 31) {
      return found(nights.find((night) => Number(night.slice(8)) === value) ?? null);
    }
    // An Excel date: days since 30 Dec 1899.
    if (value > 20_000 && value < 100_000) {
      return found(new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY_MS).toISOString().slice(0, 10));
    }
    return wrong;
  }

  const text = String(value ?? '').trim().toLowerCase();
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return found(validDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  if ((match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/))) {
    const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const [a, b] = [Number(match[1]), Number(match[2])];
    // Day first, as written in India; month first only when day first is impossible.
    return found(validDate(year, b, a) ?? (b > 12 ? validDate(year, a, b) : null));
  }
  if ((match = text.match(/^(?:night|day|show)\s*(\d{1,2})$/))) {
    return found(nights[Number(match[1]) - 1] ?? null);
  }
  if ((match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?$/))) {
    return found(nights.find((night) => Number(night.slice(8)) === Number(match![1])) ?? null);
  }

  // Month names: "17 Oct", "17th October 2026", "Sat, 17 Oct 2026 7:00 PM", "Oct 17, 2026".
  const monthIndex = MONTHS.findIndex((name) => new RegExp(`\\b${name}[a-z]*\\b`).test(text));
  if (monthIndex >= 0) {
    const withoutTime = text.replace(/\b\d{1,2}[:.]\d{2}\b(\s*[ap]\.?m\.?)?/g, ' ');
    const year = withoutTime.match(/\b(20\d{2})\b/)?.[1];
    const day = withoutTime.replace(/\b20\d{2}\b/, ' ').match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1];
    if (day) {
      return found(year ? validDate(Number(year), monthIndex + 1, Number(day)) : byMonthDay(nights, monthIndex + 1, Number(day)));
    }
  }
  return wrong;
}
