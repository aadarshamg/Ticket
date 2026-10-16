import { z } from 'zod';

export const MESSAGE_STATUS_FILTERS = ['unsent', 'queued', 'sent', 'delivered', 'read', 'failed'] as const;
export const ENTRY_STATUS_FILTERS = ['none', 'partial', 'full'] as const;

/** Query string of GET /api/tickets. */
export const ticketListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'cancelled']).optional(),
  messageStatus: z.enum(MESSAGE_STATUS_FILTERS).optional(),
  entryStatus: z.enum(ENTRY_STATUS_FILTERS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/** Body of PATCH /api/tickets/:id. Send only the fields to change. */
export const ticketPatchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be 2 to 80 characters')
      .max(80, 'Name must be 2 to 80 characters')
      .optional(),
    phone: z.string().trim().min(1, 'Enter a phone number').max(30).optional(),
    passCount: z
      .number({ invalid_type_error: 'Enter a number' })
      .int('Enter a whole number')
      .min(1, 'Must be at least 1')
      .optional(),
    /** "cancelled" cancels the booking and its unused passes; "active" restores it. */
    status: z.enum(['active', 'cancelled']).optional(),
    /** The night the booking is for ("2026-10-18"), on a multi-night event. */
    night: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a night').optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change',
  });
export type TicketPatch = z.infer<typeof ticketPatchSchema>;

/** Body of POST /api/tickets: one booking added by hand in the dashboard. */
export const ticketCreateSchema = z
  .object({
    /** Left empty, one is made up (ADD-XXXXX). */
    orderId: z.string().trim().max(64, 'Order ID must be at most 64 characters').optional(),
    name: z.string().trim().min(2, 'Name must be 2 to 80 characters').max(80, 'Name must be 2 to 80 characters'),
    phone: z.string().trim().min(1, 'Enter a phone number').max(30),
    passCount: z
      .number({ invalid_type_error: 'Enter a number' })
      .int('Enter a whole number')
      .min(1, 'Must be at least 1'),
    night: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a night').optional(),
    category: z.string().trim().max(60, 'Category must be at most 60 characters').optional(),
    email: z.string().trim().toLowerCase().email('Email is not valid').max(254).optional().or(z.literal('')),
    /** Queue the WhatsApp message straight away. */
    sendNow: z.boolean().optional(),
  })
  .strict();
export type TicketCreate = z.infer<typeof ticketCreateSchema>;
