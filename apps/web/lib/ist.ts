// All event times are entered and shown in India Standard Time (UTC+05:30, no daylight saving).
const IST_OFFSET_MS = 330 * 60 * 1000;

/** ISO instant -> value for <input type="datetime-local"> showing IST wall-clock time. */
export function isoToIstInput(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  return new Date(time + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value, read as IST -> ISO string with +05:30 offset. */
export function istInputToIso(local: string): string {
  if (!local) return '';
  return `${local.length === 16 ? `${local}:00` : local}+05:30`;
}

const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** e.g. "Sat, 14 Nov 2026, 18:00" */
export function formatIst(iso: string): string {
  return istFormat.format(new Date(iso));
}

const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(iso: string): Record<string, string> {
  return Object.fromEntries(istParts.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
}

/** e.g. "Saturday, 14 Nov 2026" */
export function formatIstDate(iso: string): string {
  const p = parts(iso);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** 24-hour time, e.g. "18:00" */
export function formatIstTime(iso: string): string {
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}
