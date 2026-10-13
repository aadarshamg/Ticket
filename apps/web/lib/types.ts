export interface Admin {
  id: string;
  email: string;
  name: string;
}

export interface SessionResponse {
  admin: Admin;
  csrfToken: string;
}

export interface EventSettings {
  id: number;
  name: string;
  organiserName: string;
  venue: string;
  city: string;
  startsAt: string;
  gatesOpenAt: string;
  endsAt: string;
  logoUrl: string | null;
  brandColour: string;
  helplineNumber: string | null;
  termsText: string;
  maxPassesPerBooking: number;
  updatedAt: string;
}

export interface Gate {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsResponse {
  event: EventSettings | null;
  gates: Gate[];
}

// --- Uploads ---------------------------------------------------------------

export type SheetColumn = 'order_id' | 'name' | 'phone' | 'passes' | 'amount' | 'category' | 'email';
export type RowAction = 'create' | 'update' | 'unchanged';

export interface PreviewRow {
  /** Row number in the spreadsheet. */
  row: number;
  valid: boolean;
  /** Each starts with "Row N: ". */
  errors: string[];
  action: RowAction | null;
  changes: string[];
  notes: string[];
  /** Cell values exactly as they were in the file. */
  raw: Record<SheetColumn, string>;
  /** Cleaned-up values that will be saved; null for an invalid row. */
  data: {
    orderId: string;
    name: string;
    phone: string;
    email: string | null;
    passCount: number;
    amount: string | null;
    category: string | null;
  } | null;
}

export interface UploadPreview {
  upload: {
    id: string;
    fileName: string;
    rowCount: number;
    validCount: number;
    errorCount: number;
    status: 'pending' | 'confirmed';
    createdAt: string;
    confirmedAt: string | null;
  };
  summary: { create: number; update: number; unchanged: number; invalid: number } | null;
  ignoredColumns: string[];
  rows: PreviewRow[];
}

export interface ConfirmResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: { row: number; orderId: string; reason: string }[];
  passesCreated: number;
  passesRemoved: number;
}

// --- Bookings --------------------------------------------------------------

export type MessageStatus = 'unsent' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type EntryStatus = 'none' | 'partial' | 'full';
export type BookingStatus = 'active' | 'cancelled';

export interface Booking {
  id: string;
  orderId: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  passCount: number;
  usedCount: number;
  amount: string | null;
  category: string | null;
  status: BookingStatus;
  messageStatus: MessageStatus;
  messageError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingList {
  items: Booking[];
  total: number;
  page: number;
  pageSize: number;
}
