import { describe, expect, it } from 'vitest';
import { currentNight, eventNights, nightLabel, nightTimes, parseNight } from '../../src/lib/nights';

// Garba Ni Ratri: two nights, gates 18:30, start 19:00, last night ends 23:59 (all IST).
const garba = {
  gatesOpenAt: new Date('2026-10-17T18:30:00+05:30'),
  startsAt: new Date('2026-10-17T19:00:00+05:30'),
  endsAt: new Date('2026-10-18T23:59:00+05:30'),
};
const nights = ['2026-10-17', '2026-10-18'];

describe('eventNights', () => {
  it('lists every night from the first to the last', () => {
    expect(eventNights(garba)).toEqual(nights);
  });

  it('treats an evening that ends after midnight as one night', () => {
    const late = {
      gatesOpenAt: new Date('2026-11-14T18:00:00+05:30'),
      startsAt: new Date('2026-11-14T19:00:00+05:30'),
      endsAt: new Date('2026-11-15T01:00:00+05:30'),
    };
    expect(eventNights(late)).toEqual(['2026-11-14']);
    expect(nightTimes(late, '2026-11-14').endsAt).toEqual(new Date('2026-11-15T01:00:00+05:30'));
  });
});

describe('nightTimes', () => {
  it('gives each night the same times of day', () => {
    expect(nightTimes(garba, '2026-10-17')).toEqual({
      gatesOpenAt: new Date('2026-10-17T18:30:00+05:30'),
      startsAt: new Date('2026-10-17T19:00:00+05:30'),
      endsAt: new Date('2026-10-17T23:59:00+05:30'),
    });
    expect(nightTimes(garba, '2026-10-18')).toEqual({
      gatesOpenAt: new Date('2026-10-18T18:30:00+05:30'),
      startsAt: new Date('2026-10-18T19:00:00+05:30'),
      endsAt: new Date('2026-10-18T23:59:00+05:30'),
    });
  });
});

describe('currentNight', () => {
  const at = (iso: string) => new Date(iso).getTime();
  it('is the night of the day, counting the small hours as the night before', () => {
    expect(currentNight(garba, at('2026-10-17T20:00:00+05:30'))).toBe('2026-10-17');
    expect(currentNight(garba, at('2026-10-18T01:30:00+05:30'))).toBe('2026-10-17');
    expect(currentNight(garba, at('2026-10-18T12:00:00+05:30'))).toBe('2026-10-18');
  });

  it('is null on days that are not event nights, so testing beforehand is not blocked', () => {
    expect(currentNight(garba, at('2026-10-15T20:00:00+05:30'))).toBeNull();
    expect(currentNight(garba, at('2026-10-19T20:00:00+05:30'))).toBeNull();
  });
});

describe('parseNight', () => {
  const night = (value: unknown) => parseNight(value, nights);

  it.each([
    ['17/10/2026', '2026-10-17'],
    ['18-10-2026', '2026-10-18'],
    ['17.10.26', '2026-10-17'],
    ['2026-10-18', '2026-10-18'],
    ['2026-10-17 19:00:00', '2026-10-17'],
    ['17 Oct', '2026-10-17'],
    ['18th October 2026', '2026-10-18'],
    ['Sat, 17 Oct 2026 7:00 PM', '2026-10-17'],
    ['Sunday, 18 Oct 2026, 19:00', '2026-10-18'],
    ['Oct 18, 2026', '2026-10-18'],
    ['17', '2026-10-17'],
    ['18th', '2026-10-18'],
    ['Night 2', '2026-10-18'],
    ['Day 1', '2026-10-17'],
  ])('reads %s', (value, expected) => {
    expect(night(value)).toEqual({ night: expected });
  });

  it('reads Excel dates and bare day numbers', () => {
    expect(night(46312)).toEqual({ night: '2026-10-17' }); // Excel serial for 17 Oct 2026
    expect(night(18)).toEqual({ night: '2026-10-18' });
  });

  it('refuses a date that is not one of the nights, saying which ones are', () => {
    const wrong = { error: "night must be one of the event's nights: Sat, 17 Oct or Sun, 18 Oct" };
    expect(night('19/10/2026')).toEqual(wrong);
    expect(night('10/17/2025')).toEqual(wrong);
    expect(night('tomorrow')).toEqual(wrong);
    expect(night('Night 3')).toEqual(wrong);
  });
});

describe('nightLabel', () => {
  it('is short and has the weekday', () => {
    expect(nightLabel('2026-10-18')).toBe('Sun, 18 Oct');
  });
});
