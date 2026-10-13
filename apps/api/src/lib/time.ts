// Event times are stored as instants and always shown in India Standard Time.

const istFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function istParts(date: Date): Record<string, string> {
  return Object.fromEntries(istFormat.formatToParts(date).map((part) => [part.type, part.value]));
}

/** Date with weekday, e.g. "Saturday, 14 Nov 2026". */
export function formatIstDate(date: Date): string {
  const p = istParts(date);
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

/** 24-hour time, e.g. "18:00". */
export function formatIstTime(date: Date): string {
  const p = istParts(date);
  return `${p.hour}:${p.minute}`;
}
