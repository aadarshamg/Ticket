import { z } from 'zod';

const requiredText = (label: string, max: number) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** ISO 8601 with an explicit offset, e.g. 2026-11-14T18:00:00+05:30. */
const instant = z
  .string()
  .datetime({ offset: true, message: 'Enter a valid date and time' })
  .transform((value) => new Date(value));

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Note: a zod `.transform()` placed after a failed check aborts the whole object, which would
// hide the cross-field errors below. Optional fields are therefore validated with `.refine()`
// and blanks are turned into null in one transform at the very end.

export const gateInputSchema = z.object({
  /** Present for an existing gate, absent for a new one. */
  id: z.string().uuid().optional(),
  name: requiredText('Gate name', 40),
  /** Required for a new gate; on an existing gate it resets the PIN. */
  pin: z
    .string()
    .regex(/^\d{6,8}$/, 'PIN must be 6 to 8 digits')
    .optional(),
  active: z.boolean().default(true),
});

export const eventInputSchema = z
  .object({
    name: requiredText('Event name', 120),
    organiserName: requiredText('Organiser name', 120),
    venue: requiredText('Venue', 160),
    city: requiredText('City', 80),
    startsAt: instant,
    gatesOpenAt: instant,
    endsAt: instant,
    logoUrl: z
      .string()
      .trim()
      .max(500, 'Logo URL must be at most 500 characters')
      .refine((value) => value === '' || isHttpUrl(value), 'Enter a valid URL starting with http:// or https://')
      .nullish(),
    brandColour: z
      .string({ required_error: 'Brand colour is required' })
      .toLowerCase()
      .regex(/^#[0-9a-f]{6}$/, 'Use a hex colour like #4f46e5'),
    helplineNumber: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\+?\d[\d\s-]{5,18}$/.test(value), 'Enter a valid phone number')
      .nullish(),
    termsText: z.string().max(5000, 'Terms must be at most 5000 characters').default(''),
    maxPassesPerBooking: z
      .number({ invalid_type_error: 'Enter a number' })
      .int('Enter a whole number')
      .min(1, 'Must be at least 1')
      .max(50, 'Must be at most 50'),
    /** When present, replaces the whole gate list: gates left out are deleted. */
    gates: z.array(gateInputSchema).max(30, 'At most 30 gates').optional(),
  })
  .superRefine((value, ctx) => {
    if (value.gatesOpenAt > value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gatesOpenAt'],
        message: 'Gates must open at or before the start time',
      });
    }
    if (value.endsAt <= value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'End time must be after the start time',
      });
    }

    const names = new Map<string, number>();
    const pins = new Map<string, number>();
    (value.gates ?? []).forEach((gate, index) => {
      const nameKey = gate.name.toLowerCase();
      if (names.has(nameKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gates', index, 'name'],
          message: 'Gate names must be different',
        });
      }
      names.set(nameKey, index);

      if (!gate.id && !gate.pin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['gates', index, 'pin'],
          message: 'A new gate needs a PIN',
        });
      }
      if (gate.pin) {
        if (pins.has(gate.pin)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['gates', index, 'pin'],
            message: 'Each gate needs its own PIN',
          });
        }
        pins.set(gate.pin, index);
      }
    });
  })
  .transform((value) => ({
    ...value,
    logoUrl: value.logoUrl || null,
    helplineNumber: value.helplineNumber || null,
  }));

export type EventInput = z.infer<typeof eventInputSchema>;
export type GateInput = z.infer<typeof gateInputSchema>;
