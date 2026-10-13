/** WhatsApp template that delivers the pass link. A booking is "unsent" until it has a Message row for it. */
export const TICKET_TEMPLATE = 'event_ticket_v1';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 10_000;
/** A preview that is not confirmed within this time must be uploaded again. */
export const UPLOAD_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
