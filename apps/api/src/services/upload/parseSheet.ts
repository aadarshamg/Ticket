import path from 'node:path';
import * as XLSX from 'xlsx';
import { MAX_UPLOAD_ROWS } from '../../config/constants';
import { HttpError } from '../../middleware/errors';

export const COLUMNS = ['order_id', 'name', 'phone', 'passes', 'amount', 'category', 'email', 'night'] as const;
export type ColumnName = (typeof COLUMNS)[number];
export const REQUIRED_COLUMNS: readonly ColumnName[] = ['order_id', 'name', 'phone', 'passes'];

/** Other headings booking exports use for the same columns. */
const ALIASES: Record<string, ColumnName> = {
  date: 'night',
  event_date: 'night',
  show_date: 'night',
  show_day: 'night',
};

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

export interface SheetRow {
  /** Row number as shown in the spreadsheet (the header is usually row 1). */
  row: number;
  cells: Partial<Record<ColumnName, unknown>>;
}

export interface ParsedSheet {
  presentColumns: ColumnName[];
  ignoredColumns: string[];
  rows: SheetRow[];
}

const badFile = (message: string) => new HttpError(400, 'invalid_file', message);

/** "Order ID " -> "order_id" */
function normaliseHeader(cell: unknown): string {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** CSV text: UTF-8 if it is valid UTF-8, otherwise Windows-1252 (what Excel on Windows writes). */
function decodeCsv(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  return text.replace(/^﻿/, '');
}

/**
 * Reads the first sheet of an Excel or CSV file. The first row is the header; columns are
 * matched case-insensitively with surrounding spaces ignored. Throws HttpError(400) for
 * problems with the file as a whole; per-row problems are left to validateRows.
 */
export function parseSheet(buffer: Buffer, fileName: string): ParsedSheet {
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw badFile('Upload an Excel (.xlsx, .xls) or CSV (.csv) file.');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook =
      extension === '.csv'
        ? // raw: keep CSV values as text so "+1415..." and leading zeros survive
          XLSX.read(decodeCsv(buffer), { type: 'string', raw: true })
        : XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw badFile('This file could not be read. Save it again as .xlsx or .csv and retry.');
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet || !sheet['!ref']) throw badFile('The file is empty.');

  const firstRowIndex = XLSX.utils.decode_range(sheet['!ref']).s.r;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  const headerCells = matrix[0] ?? [];
  if (headerCells.every(isBlank)) throw badFile('The file is empty.');

  const columnIndex = new Map<ColumnName, number>();
  const ignoredColumns: string[] = [];
  headerCells.forEach((cell, index) => {
    const normalised = normaliseHeader(cell);
    const header = ALIASES[normalised] ?? normalised;
    if (!header) return;
    if (!(COLUMNS as readonly string[]).includes(header)) {
      ignoredColumns.push(String(cell).trim());
      return;
    }
    const column = header as ColumnName;
    if (columnIndex.has(column)) throw badFile(`Column "${column}" appears more than once.`);
    columnIndex.set(column, index);
  });

  const missing = REQUIRED_COLUMNS.filter((column) => !columnIndex.has(column));
  if (missing.length > 0) {
    throw badFile(
      `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        'The first row must contain the column names order_id, name, phone, passes ' +
        '(amount, category, email and night are optional).',
    );
  }

  const rows: SheetRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const cells: SheetRow['cells'] = {};
    let hasValue = false;
    for (const [column, index] of columnIndex) {
      const value = line[index] ?? null;
      cells[column] = value;
      if (!isBlank(value)) hasValue = true;
    }
    if (!hasValue) continue; // skip empty lines, keeping real row numbers for the rest
    rows.push({ row: firstRowIndex + i + 1, cells });
    if (rows.length > MAX_UPLOAD_ROWS) {
      throw badFile(`The file has more than ${MAX_UPLOAD_ROWS.toLocaleString('en-IN')} booking rows.`);
    }
  }
  if (rows.length === 0) throw badFile('The file has a header row but no bookings.');

  return { presentColumns: COLUMNS.filter((column) => columnIndex.has(column)), ignoredColumns, rows };
}
