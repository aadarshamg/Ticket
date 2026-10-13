import type { PassStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isEmptyPlan, planPassCountChange, type PassRef } from '../../src/services/passes';

/** passes('valid', 'used') -> pass 1 valid (id p1), pass 2 used (id p2) */
const passes = (...statuses: PassStatus[]): PassRef[] =>
  statuses.map((status, index) => ({ id: `p${index + 1}`, passNo: index + 1, status }));

const plan = (current: PassRef[], newCount: number) => {
  const result = planPassCountChange(current, newCount);
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
};

describe('planPassCountChange', () => {
  it('does nothing when the count is unchanged', () => {
    expect(isEmptyPlan(plan(passes('valid', 'used', 'valid'), 3))).toBe(true);
  });

  it('adds passes numbered after the existing ones', () => {
    expect(plan(passes('valid', 'used'), 5)).toEqual({ remove: [], renumber: [], add: [3, 4, 5] });
  });

  it('removes the highest-numbered unused passes first', () => {
    expect(plan(passes('valid', 'valid', 'valid', 'valid'), 2)).toEqual({
      remove: ['p4', 'p3'],
      renumber: [],
      add: [],
    });
  });

  it('never removes a used pass, and renumbers what is left to 1..n', () => {
    // pass 4 was used at the gate; cutting to 2 must keep it
    expect(plan(passes('valid', 'valid', 'valid', 'used'), 2)).toEqual({
      remove: ['p3', 'p2'],
      renumber: [{ id: 'p4', passNo: 2 }],
      add: [],
    });
    expect(plan(passes('used', 'valid', 'used', 'valid'), 2)).toEqual({
      remove: ['p4', 'p2'],
      renumber: [{ id: 'p3', passNo: 2 }],
      add: [],
    });
  });

  it('allows reducing to exactly the number already used', () => {
    expect(plan(passes('used', 'used', 'valid'), 2)).toEqual({ remove: ['p3'], renumber: [], add: [] });
  });

  it('refuses a reduction that would delete a used pass', () => {
    expect(planPassCountChange(passes('used', 'used', 'used', 'valid'), 2)).toEqual({
      ok: false,
      reason: 'cannot reduce to 2 passes: 3 already used',
    });
    expect(planPassCountChange(passes('used', 'used'), 1)).toEqual({
      ok: false,
      reason: 'cannot reduce to 1 pass: 2 already used',
    });
  });

  it('removes cancelled passes like any other unused pass', () => {
    expect(plan(passes('cancelled', 'cancelled', 'cancelled'), 1)).toEqual({
      remove: ['p3', 'p2'],
      renumber: [],
      add: [],
    });
  });

  it('repairs gaps in numbering while adding', () => {
    const gappy: PassRef[] = [
      { id: 'a', passNo: 1, status: 'valid' },
      { id: 'b', passNo: 4, status: 'valid' },
    ];
    expect(plan(gappy, 3)).toEqual({ remove: [], renumber: [{ id: 'b', passNo: 2 }], add: [3] });
  });
});
