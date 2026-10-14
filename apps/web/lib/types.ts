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

// --- Sending ---------------------------------------------------------------

export interface SendStatus {
  /** False when the server has no queue or WhatsApp settings. */
  configured: boolean;
  problem: string | null;
  /** "mock" = test mode (messages are only logged); "cloud" or "wasarathi" = real WhatsApp. */
  sender: string | null;
  counts: { unsent: number; queued: number; sent: number; delivered: number; read: number; failed: number };
  /** Bookings that still have unused passes. */
  reminderCandidates: number;
  queue: {
    paused: boolean;
    pauseReason: 'manual' | 'failure_rate' | null;
    pausedAt: string | null;
    startedAt: string | null;
    /** The current (or last) run. */
    total: number;
    sent: number;
    failed: number;
    /** Messages still waiting in the queue. */
    pending: number;
  } | null;
}

export interface SendQueued {
  batchId: string;
  template: string;
  queued: number;
}

export interface TestSendResult {
  sender: string;
  orderId: string;
  results: { phone: string; ok: boolean; error: string | null }[];
}

// --- Gate scanner ----------------------------------------------------------

export interface GateSessionInfo {
  gate: string;
  deviceId: string;
  csrfToken: string;
}

export type ScanResultKind = 'ok' | 'already_used' | 'invalid' | 'cancelled';

/** All a volunteer is shown about a booking: no phone, email or order ID. */
export interface ScanBooking {
  ticketId: string;
  name: string;
  category: string | null;
  passCount: number;
  /** Passes still valid (people still to come). */
  remaining: number;
}

export interface ScanOutcome {
  result: ScanResultKind;
  booking?: ScanBooking;
  pass?: { passNo: number; usedAt: string | null; usedGate: string | null };
}

export interface AdmitAllOutcome {
  admitted: number;
  cancelled: boolean;
  booking: ScanBooking;
}

export interface LookupResult {
  ticketId: string;
  name: string;
  category: string | null;
  cancelled: boolean;
  passCount: number;
  entered: number;
  remaining: number;
}

/** Someone admitted by an offline scanner whose pass turned out not to be valid. */
export interface Conflict {
  id: string;
  result: 'already_used' | 'cancelled' | 'invalid';
  /** Where and when the person was let in offline. */
  gate: string;
  deviceId: string;
  scannedAt: string;
  booking: { orderId: string; name: string; passNo: number; passCount: number } | null;
  /** The entry the pass is recorded against (for "already used": the other admission). */
  recordedEntry: { gate: string | null; at: string } | null;
}

// --- Dashboard and activity log ---------------------------------------------

export interface Stats {
  generatedAt: string;
  bookings: { total: number; active: number; cancelled: number };
  passes: { total: number; valid: number; used: number; cancelled: number };
  messages: { unsent: number; queued: number; sent: number; delivered: number; read: number; failed: number };
  entered: number;
  stillToCome: number;
  gates: { gate: string; entered: number; lastEntryAt: string | null }[];
  conflicts: number;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorType: 'admin' | 'gate' | 'system';
  actorLabel: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  meta: Record<string, unknown> | null;
}

export interface AuditList {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
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
