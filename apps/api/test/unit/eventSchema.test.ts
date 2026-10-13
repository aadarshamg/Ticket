import { describe, expect, it } from 'vitest';
import { eventInputSchema } from '../../src/schemas/event';

const valid = {
  name: '  Winter Music Night  ',
  organiserName: 'Sangam Events',
  venue: 'Palace Grounds',
  city: 'Bengaluru',
  startsAt: '2026-11-14T18:00:00+05:30',
  gatesOpenAt: '2026-11-14T16:30:00+05:30',
  endsAt: '2026-11-14T23:00:00+05:30',
  logoUrl: '',
  brandColour: '#4F46E5',
  helplineNumber: '',
  termsText: '',
  maxPassesPerBooking: 10,
};

const issuePaths = (input: unknown) => {
  const result = eventInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('eventInputSchema', () => {
  it('accepts valid settings, trimming text and normalising blanks', () => {
    const parsed = eventInputSchema.parse(valid);
    expect(parsed.name).toBe('Winter Music Night');
    expect(parsed.brandColour).toBe('#4f46e5');
    expect(parsed.logoUrl).toBeNull();
    expect(parsed.helplineNumber).toBeNull();
    expect(parsed.startsAt.toISOString()).toBe('2026-11-14T12:30:00.000Z');
    expect(parsed.gates).toBeUndefined();
  });

  it('requires times to carry an offset', () => {
    expect(issuePaths({ ...valid, startsAt: '2026-11-14T18:00:00' })).toContain('startsAt');
  });

  it('requires gates-open <= start < end', () => {
    expect(issuePaths({ ...valid, gatesOpenAt: '2026-11-14T18:30:00+05:30' })).toEqual(['gatesOpenAt']);
    expect(issuePaths({ ...valid, endsAt: valid.startsAt })).toEqual(['endsAt']);
    expect(issuePaths({ ...valid, gatesOpenAt: valid.startsAt })).toEqual([]);
  });

  it('validates logo URL, colour, helpline and pass limit', () => {
    expect(issuePaths({ ...valid, logoUrl: 'javascript:alert(1)' })).toContain('logoUrl');
    expect(issuePaths({ ...valid, logoUrl: 'https://cdn.example.com/logo.png' })).toEqual([]);
    expect(issuePaths({ ...valid, brandColour: '#fff' })).toEqual(['brandColour']);
    expect(issuePaths({ ...valid, helplineNumber: 'call us' })).toContain('helplineNumber');
    expect(issuePaths({ ...valid, maxPassesPerBooking: 2.5 })).toEqual(['maxPassesPerBooking']);
    expect(issuePaths({ ...valid, maxPassesPerBooking: 51 })).toEqual(['maxPassesPerBooking']);
  });

  it('reports field errors and time-order errors together', () => {
    const paths = issuePaths({
      ...valid,
      name: '   ',
      logoUrl: 'not a url',
      brandColour: 'purple',
      helplineNumber: 'call us',
      maxPassesPerBooking: 0,
      gatesOpenAt: '2026-11-14T19:00:00+05:30',
      endsAt: '2026-11-14T17:00:00+05:30',
    });
    expect(paths.sort()).toEqual(
      ['brandColour', 'endsAt', 'gatesOpenAt', 'helplineNumber', 'logoUrl', 'maxPassesPerBooking', 'name'].sort(),
    );
  });

  it('validates the gate list', () => {
    expect(issuePaths({ ...valid, gates: [{ name: 'Gate A', pin: '1234' }] })).toEqual([]);
    expect(issuePaths({ ...valid, gates: [{ name: 'Gate A' }] })).toEqual(['gates.0.pin']);
    expect(issuePaths({ ...valid, gates: [{ name: 'Gate A', pin: '12ab' }] })).toEqual(['gates.0.pin']);
    expect(
      issuePaths({
        ...valid,
        gates: [
          { name: 'Gate A', pin: '1234' },
          { name: 'GATE A', pin: '1234' },
        ],
      }),
    ).toEqual(['gates.1.name', 'gates.1.pin']);
    // An existing gate may be saved without a PIN (keeps the current one).
    expect(
      issuePaths({ ...valid, gates: [{ id: '3f1c2b9e-8a4d-4c6f-9b1a-2d3e4f5a6b7c', name: 'Gate A' }] }),
    ).toEqual([]);
  });
});
