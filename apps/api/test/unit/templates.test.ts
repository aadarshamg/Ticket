import { Prisma, type Event } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { buildReminderMessage, buildTicketMessage, cleanParam, formatAmount } from '../../src/messaging/templates';
import { env } from '../../src/config/env';
import { formatIstDate, formatIstTime } from '../../src/lib/time';

const event = {
  id: 1,
  name: 'Winter Music Night',
  organiserName: 'Sangam Events',
  venue: 'Palace Grounds',
  city: 'Bengaluru',
  startsAt: new Date('2026-11-14T18:00:00+05:30'),
  gatesOpenAt: new Date('2026-11-14T16:30:00+05:30'),
  endsAt: new Date('2026-11-14T23:00:00+05:30'),
} as Event;

const ticket = {
  name: 'Asha Rao',
  phone: '+919876543210',
  orderId: 'ORD-1001',
  code: 'ABCDEFGH2345',
  passCount: 4,
  amount: new Prisma.Decimal('3196'),
};

describe('IST formatting', () => {
  it('formats the date with weekday and the time in 24-hour form', () => {
    expect(formatIstDate(event.startsAt)).toBe('Saturday, 14 Nov 2026');
    expect(formatIstTime(event.startsAt)).toBe('18:00');
    expect(formatIstTime(new Date('2026-11-14T09:05:00+05:30'))).toBe('09:05');
  });

  it('uses India time whatever the server time zone', () => {
    // 20:00 UTC on the 13th is already 01:30 on the 14th in India.
    const instant = new Date('2026-11-13T20:00:00Z');
    expect(formatIstDate(instant)).toBe('Saturday, 14 Nov 2026');
    expect(formatIstTime(instant)).toBe('01:30');
  });
});

describe('event_ticket_v1', () => {
  it('fills the nine body variables in the agreed order, with the booking code on the button', () => {
    expect(buildTicketMessage(event, ticket)).toMatchObject({
      to: '+919876543210',
      template: 'event_ticket_v1',
      language: 'en',
      bodyParams: [
        'Asha Rao', // 1 name
        'Winter Music Night', // 2 event name
        'Saturday, 14 Nov 2026', // 3 date with weekday
        '18:00', // 4 start time, 24h
        'Palace Grounds, Bengaluru', // 5 venue, city
        '4', // 6 number of passes
        '3,196', // 7 amount
        'ORD-1001', // 8 order ID
        'Sangam Events', // 9 organiser name
      ],
      buttonUrlSuffix: 'ABCDEFGH2345',
      passUrl: `${env.PUBLIC_BASE_URL}/b/ABCDEFGH2345`,
    });
  });

  it('never sends an empty or multi-line value (WhatsApp rejects those)', () => {
    const message = buildTicketMessage(
      { ...event, venue: 'Palace\nGrounds', name: 'Winter\tMusic      Night' },
      { ...ticket, name: '  Asha \n Rao ', amount: null },
    );
    expect(message.bodyParams[0]).toBe('Asha Rao');
    expect(message.bodyParams[1]).toBe('Winter Music Night');
    expect(message.bodyParams[4]).toBe('Palace Grounds, Bengaluru');
    expect(message.bodyParams[6]).toBe('-');
    expect(message.bodyParams.every((value) => value.length > 0 && !/[\n\t]| {5}/.test(value))).toBe(true);
  });
});

describe('formatAmount', () => {
  it('uses Indian digit grouping and drops needless decimals', () => {
    expect(formatAmount(new Prisma.Decimal('799.00'))).toBe('799');
    expect(formatAmount(new Prisma.Decimal('125000'))).toBe('1,25,000');
    expect(formatAmount(new Prisma.Decimal('1598.50'))).toBe('1,598.5');
    expect(formatAmount(new Prisma.Decimal('0'))).toBe('0');
    expect(formatAmount(null)).toBe('-');
  });
});

describe('event_reminder_v1', () => {
  it('fills its eight body variables', () => {
    expect(buildReminderMessage(event, ticket, 3)).toMatchObject({
      to: '+919876543210',
      template: 'event_reminder_v1',
      language: 'en',
      bodyParams: [
        'Asha Rao',
        'Winter Music Night',
        'Saturday, 14 Nov 2026',
        '18:00',
        'Palace Grounds, Bengaluru',
        '16:30', // gates open
        '3', // passes not yet used
        'Sangam Events',
      ],
      buttonUrlSuffix: 'ABCDEFGH2345',
      passUrl: `${env.PUBLIC_BASE_URL}/b/ABCDEFGH2345`,
    });
  });
});

describe('cleanParam', () => {
  it('collapses whitespace', () => {
    expect(cleanParam('  a \n\n b\t c      d ')).toBe('a b c d');
  });
});

describe('named values', () => {
  it('gives each value its WaSarathi variable name, so a template can leave some out', () => {
    expect(buildTicketMessage(event, ticket).namedParams).toMatchObject({
      BUYER: 'Asha Rao',
      ORDERID: 'ORD-1001',
      ORGANISER: 'Sangam Events',
      PASSES: '4',
    });
  });
});
