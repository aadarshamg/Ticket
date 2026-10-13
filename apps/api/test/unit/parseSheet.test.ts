import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSheet } from '../../src/services/upload/parseSheet';

export function xlsxBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Bookings');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const message = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected an error');
};

describe('parseSheet', () => {
  it('reads an .xlsx file, matching headers case-insensitively and trimming them', () => {
    const sheet = parseSheet(
      xlsxBuffer([
        [' Order_ID ', 'NAME', 'Phone', 'passes', 'Notes'],
        ['ORD-1', 'Asha Rao', 9876543210, 4, 'vip guest'],
        ['ORD-2', 'Dev Shah', '+91 98765 43211', 2, null],
      ]),
      'bookings.xlsx',
    );
    expect(sheet.presentColumns).toEqual(['order_id', 'name', 'phone', 'passes']);
    expect(sheet.ignoredColumns).toEqual(['Notes']);
    expect(sheet.rows).toEqual([
      { row: 2, cells: { order_id: 'ORD-1', name: 'Asha Rao', phone: 9876543210, passes: 4 } },
      { row: 3, cells: { order_id: 'ORD-2', name: 'Dev Shah', phone: '+91 98765 43211', passes: 2 } },
    ]);
  });

  it('accepts "Order ID" style headers and columns in any order', () => {
    const sheet = parseSheet(
      xlsxBuffer([
        ['Passes', 'Phone', 'Name', 'Order ID', 'Email'],
        [1, '9876543210', 'Asha Rao', 'X1', 'a@b.co'],
      ]),
      'b.xlsx',
    );
    expect(sheet.presentColumns).toEqual(['order_id', 'name', 'phone', 'passes', 'email']);
    expect(sheet.rows[0]!.cells).toMatchObject({ order_id: 'X1', email: 'a@b.co' });
  });

  it('skips blank lines but keeps the real spreadsheet row numbers', () => {
    const sheet = parseSheet(
      xlsxBuffer([
        ['order_id', 'name', 'phone', 'passes'],
        ['A', 'Asha Rao', '9876543210', 1],
        [null, null, null, null],
        ['  ', '', null, null],
        ['B', 'Dev Shah', '9876543211', 2],
      ]),
      'b.xlsx',
    );
    expect(sheet.rows.map((row) => row.row)).toEqual([2, 5]);
  });

  it('reads CSV as text, so + prefixes and leading zeros survive', () => {
    const csv = 'order_id,name,phone,passes\nA1,Asha Rao,+14155550123,2\nA2,"Shah, Dev",09876543210,1\n';
    const sheet = parseSheet(Buffer.from(csv, 'utf8'), 'bookings.csv');
    expect(sheet.rows).toEqual([
      { row: 2, cells: { order_id: 'A1', name: 'Asha Rao', phone: '+14155550123', passes: '2' } },
      { row: 3, cells: { order_id: 'A2', name: 'Shah, Dev', phone: '09876543210', passes: '1' } },
    ]);
  });

  it('reads CSV in UTF-8 (with or without BOM) and in Windows-1252', () => {
    const csv = 'order_id,name,phone,passes\nA1,José Núñez,9876543210,1\n';
    const name = (buffer: Buffer) => parseSheet(buffer, 'b.csv').rows[0]!.cells.name;
    expect(name(Buffer.from(csv, 'utf8'))).toBe('José Núñez');
    expect(name(Buffer.from(`﻿${csv}`, 'utf8'))).toBe('José Núñez');
    expect(name(Buffer.from(csv, 'latin1'))).toBe('José Núñez');
    const hindi = 'order_id,name,phone,passes\nA1,आशा राव,9876543210,1\n';
    expect(name(Buffer.from(hindi, 'utf8'))).toBe('आशा राव');
  });

  it('names the missing required columns', () => {
    expect(message(() => parseSheet(xlsxBuffer([['order_id', 'name'], ['A', 'B']]), 'b.xlsx'))).toMatch(
      /^Missing required columns: phone, passes\./,
    );
  });

  it('rejects duplicate columns, empty files and unsupported types', () => {
    expect(
      message(() => parseSheet(xlsxBuffer([['order_id', 'name', 'phone', 'Phone', 'passes']]), 'b.xlsx')),
    ).toBe('Column "phone" appears more than once.');
    expect(message(() => parseSheet(xlsxBuffer([['order_id', 'name', 'phone', 'passes']]), 'b.xlsx'))).toBe(
      'The file has a header row but no bookings.',
    );
    expect(message(() => parseSheet(Buffer.from(''), 'b.csv'))).toBe('The file is empty.');
    expect(message(() => parseSheet(Buffer.from('%PDF-1.7'), 'bookings.pdf'))).toBe(
      'Upload an Excel (.xlsx, .xls) or CSV (.csv) file.',
    );
  });
});
