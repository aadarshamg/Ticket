import { describe, expect, it } from 'vitest';
import type { SheetRow } from '../../src/services/upload/parseSheet';
import { validateRows } from '../../src/services/upload/validateRows';

const good = { order_id: 'ORD-1', name: 'Asha Rao', phone: '9876543210', passes: 4 };

/** Validates one row (numbered 2) and returns its result. */
const check = (cells: SheetRow['cells'], max = 10) => validateRows([{ row: 2, cells }], max)[0]!;

describe('validateRows', () => {
  it('accepts a minimal valid row and normalises it', () => {
    const result = check(good);
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      orderId: 'ORD-1',
      name: 'Asha Rao',
      phone: '+919876543210',
      email: null,
      passCount: 4,
      amount: null,
      category: null,
      night: null,
    });
  });

  it('accepts optional columns and numeric cells', () => {
    const result = check({
      order_id: 1001,
      name: '  Asha   Rao ',
      phone: 919876543210,
      passes: '3',
      amount: 2397,
      category: ' VIP ',
      email: ' Asha.Rao@Example.COM ',
    });
    expect(result.errors).toEqual([]);
    expect(result.data).toEqual({
      orderId: '1001',
      name: 'Asha Rao',
      phone: '+919876543210',
      email: 'asha.rao@example.com',
      passCount: 3,
      amount: '2397.00',
      category: 'VIP',
      night: null,
    });
    expect(result.raw.order_id).toBe('1001');
  });

  it('reports the row number and the exact reason', () => {
    expect(validateRows([{ row: 214, cells: { ...good, phone: '987654321' } }], 10)[0]!.errors).toEqual([
      'Row 214: phone has 9 digits',
    ]);
  });

  it('reports every problem in a row, and returns no data for it', () => {
    const result = check({ order_id: '', name: 'A', phone: 'abc', passes: 0, amount: 'free', email: 'nope' });
    expect(result.errors).toEqual([
      'Row 2: order_id is missing',
      'Row 2: name must be 2 to 80 characters',
      'Row 2: phone contains letters or symbols',
      'Row 2: passes must be between 1 and 10',
      'Row 2: amount is not a number',
      'Row 2: email is not valid',
    ]);
    expect(result.data).toBeNull();
  });

  it('checks name length', () => {
    expect(check({ ...good, name: null }).errors).toEqual(['Row 2: name is missing']);
    expect(check({ ...good, name: 'Al' }).errors).toEqual([]);
    expect(check({ ...good, name: 'x'.repeat(81) }).errors).toEqual(['Row 2: name must be 2 to 80 characters']);
  });

  it('checks passes is a whole number within the event limit', () => {
    expect(check({ ...good, passes: null }).errors).toEqual(['Row 2: passes is missing']);
    expect(check({ ...good, passes: 2.5 }).errors).toEqual(['Row 2: passes must be a whole number']);
    expect(check({ ...good, passes: 'four' }).errors).toEqual(['Row 2: passes must be a whole number']);
    expect(check({ ...good, passes: '-1' }).errors).toEqual(['Row 2: passes must be a whole number']);
    expect(check({ ...good, passes: 11 }).errors).toEqual(['Row 2: passes must be between 1 and 10']);
    expect(check({ ...good, passes: 6 }, 6).errors).toEqual([]);
    expect(check({ ...good, passes: 7 }, 6).errors).toEqual(['Row 2: passes must be between 1 and 6']);
  });

  it('parses amounts written the way people write rupees', () => {
    expect(check({ ...good, amount: '1,200' }).data?.amount).toBe('1200.00');
    expect(check({ ...good, amount: '₹1200.5' }).data?.amount).toBe('1200.50');
    expect(check({ ...good, amount: 'Rs. 1,200' }).data?.amount).toBe('1200.00');
    expect(check({ ...good, amount: 'INR 999' }).data?.amount).toBe('999.00');
    expect(check({ ...good, amount: 0 }).data?.amount).toBe('0.00');
    expect(check({ ...good, amount: 799.999 }).data?.amount).toBe('800.00');
    expect(check({ ...good, amount: '' }).data?.amount).toBeNull();
    expect(check({ ...good, amount: -5 }).errors).toEqual(['Row 2: amount is out of range']);
    expect(check({ ...good, amount: '12 each' }).errors).toEqual(['Row 2: amount is not a number']);
  });

  it('rejects every row that shares an order_id within the file', () => {
    const results = validateRows(
      [
        { row: 2, cells: { ...good, order_id: 'A' } },
        { row: 3, cells: { ...good, order_id: 'B' } },
        { row: 7, cells: { ...good, order_id: 'A', name: 'Someone Else' } },
      ],
      10,
    );
    expect(results[0]!.errors).toEqual(['Row 2: order_id "A" appears more than once (rows 2, 7)']);
    expect(results[0]!.data).toBeNull();
    expect(results[1]!.errors).toEqual([]);
    expect(results[2]!.errors).toEqual(['Row 7: order_id "A" appears more than once (rows 2, 7)']);
  });

  it('reads the night on a multi-night event and insists on one when the column is there', () => {
    const nights = ['2026-10-17', '2026-10-18'];
    const row = (night: unknown) => validateRows([{ row: 2, cells: { ...good, night } }], 10, nights)[0]!;
    expect(row('18/10/2026').data?.night).toBe('2026-10-18');
    expect(row('Sat, 17 Oct 2026 7:00 PM').data?.night).toBe('2026-10-17');
    expect(row('').errors).toEqual(['Row 2: night is missing (Sat, 17 Oct or Sun, 18 Oct)']);
    expect(row('20/10/2026').errors).toEqual([
      "Row 2: night must be one of the event's nights: Sat, 17 Oct or Sun, 18 Oct",
    ]);
    // Without the column, the row is left for the booking check to decide.
    expect(validateRows([{ row: 2, cells: good }], 10, nights)[0]!.data?.night).toBeNull();
  });

  it('limits order_id and category length', () => {
    expect(check({ ...good, order_id: 'x'.repeat(65) }).errors).toEqual([
      'Row 2: order_id is longer than 64 characters',
    ]);
    expect(check({ ...good, category: 'x'.repeat(61) }).errors).toEqual([
      'Row 2: category is longer than 60 characters',
    ]);
  });
});
