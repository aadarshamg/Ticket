import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { classifyRow, type ExistingTicket } from '../../src/services/upload/classify';
import type { ColumnName } from '../../src/services/upload/parseSheet';
import type { RowData } from '../../src/services/upload/validateRows';

const row: RowData = {
  orderId: 'ORD-1',
  name: 'Asha Rao',
  phone: '+919876543210',
  email: 'asha@example.com',
  passCount: 2,
  amount: '1598.00',
  category: 'General',
  night: null,
};

const existing: ExistingTicket = {
  id: 't1',
  orderId: 'ORD-1',
  name: 'Asha Rao',
  phone: '+919876543210',
  email: 'asha@example.com',
  passCount: 2,
  amount: new Prisma.Decimal('1598'),
  category: 'General',
  night: null,
  status: 'active',
  passes: [
    { id: 'p1', passNo: 1, status: 'valid' },
    { id: 'p2', passNo: 2, status: 'valid' },
  ],
};

const all = new Set<ColumnName>(['order_id', 'name', 'phone', 'passes', 'amount', 'category', 'email']);
const requiredOnly = new Set<ColumnName>(['order_id', 'name', 'phone', 'passes']);

describe('classifyRow', () => {
  it('creates a booking when the order ID is new', () => {
    expect(classifyRow(row, undefined, all)).toMatchObject({ ok: true, action: 'create', data: row });
  });

  it('reports no change when the row matches the stored booking', () => {
    expect(classifyRow(row, existing, all)).toMatchObject({ ok: true, action: 'unchanged', changes: [] });
  });

  it('lists what an update changes', () => {
    const result = classifyRow(
      { ...row, name: 'Asha R', phone: '+919876500000', passCount: 4, amount: '3196.00' },
      existing,
      all,
    );
    expect(result).toMatchObject({
      ok: true,
      action: 'update',
      changes: ['name', 'phone', 'amount', 'passes 2 → 4'],
      passPlan: { remove: [], renumber: [], add: [3, 4] },
    });
  });

  it('keeps stored optional values when their column is absent from the file', () => {
    const result = classifyRow({ ...row, email: null, amount: null, category: null }, existing, requiredOnly);
    expect(result).toMatchObject({
      ok: true,
      action: 'unchanged',
      data: { email: 'asha@example.com', amount: '1598.00', category: 'General' },
    });
  });

  it('clears stored optional values when the column is present but blank', () => {
    const result = classifyRow({ ...row, email: null, amount: null, category: null }, existing, all);
    expect(result).toMatchObject({
      ok: true,
      action: 'update',
      changes: ['email', 'amount', 'category'],
      data: { email: null, amount: null, category: null },
    });
  });

  it('refuses a pass reduction below the number already used', () => {
    const used: ExistingTicket = {
      ...existing,
      passCount: 3,
      passes: [1, 2, 3].map((n) => ({ id: `p${n}`, passNo: n, status: 'used' as const })),
    };
    expect(classifyRow({ ...row, passCount: 2 }, used, all)).toEqual({
      ok: false,
      reason: 'cannot reduce to 2 passes: 3 already used',
    });
  });

  it('on a multi-night event, refuses a new booking without a night', () => {
    const nights = ['2026-10-17', '2026-10-18'];
    expect(classifyRow(row, undefined, all, nights)).toEqual({
      ok: false,
      reason: 'night is missing: add a night column (Sat, 17 Oct or Sun, 18 Oct)',
    });
    expect(classifyRow({ ...row, night: '2026-10-18' }, undefined, all, nights)).toMatchObject({ ok: true, action: 'create' });
  });

  it('changes the night when the column is present, and keeps it when absent', () => {
    const withNight = new Set<ColumnName>([...all, 'night']);
    const stored = { ...existing, night: new Date('2026-10-17T00:00:00Z') };
    expect(classifyRow({ ...row, night: '2026-10-18' }, stored, withNight)).toMatchObject({
      ok: true,
      action: 'update',
      changes: ['night'],
      data: { night: '2026-10-18' },
    });
    expect(classifyRow(row, stored, all)).toMatchObject({ ok: true, action: 'unchanged', data: { night: '2026-10-17' } });
  });

  it('notes that a cancelled booking stays cancelled', () => {
    const result = classifyRow(row, { ...existing, status: 'cancelled' }, all);
    expect(result).toMatchObject({ ok: true, notes: ['This booking is cancelled and will stay cancelled'] });
  });
});
