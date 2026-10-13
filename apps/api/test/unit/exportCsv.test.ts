import { describe, expect, it } from 'vitest';
import { csvCell } from '../../src/services/exportCsv';

describe('csvCell', () => {
  it('leaves plain values alone and turns nothing into an empty cell', () => {
    expect(csvCell('Asha Rao')).toBe('Asha Rao');
    expect(csvCell(4)).toBe('4');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Shah, Dev')).toBe('"Shah, Dev"');
    expect(csvCell('Dev "DJ" Shah')).toBe('"Dev ""DJ"" Shah"');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('stops a booking name from running as a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","Click")')).toBe('"\'=HYPERLINK(""http://evil.example"",""Click"")"');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });

  it('leaves phone numbers and plain numbers readable', () => {
    expect(csvCell('+919876543210')).toBe('+919876543210');
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell(-5)).toBe('-5');
    // Not purely digits, so it is still guarded.
    expect(csvCell('+1 415 555 0123')).toBe("'+1 415 555 0123");
  });
});
