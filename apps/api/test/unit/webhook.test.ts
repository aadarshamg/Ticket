import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MIN_SAMPLE, shouldAutoPause } from '../../src/messaging/sendState';
import { extractStatuses, REPLACEABLE, verifyWebhookSignature } from '../../src/services/webhook';

const secret = 'app-secret-for-tests';
const sign = (body: Buffer | string, key = secret) => `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

  it('accepts the HMAC-SHA256 of the exact body with the app secret', () => {
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifyWebhookSignature(body, sign(body, 'someone-elses-secret'), secret)).toBe(false);
  });

  it('rejects a body that was changed after signing, even by one byte', () => {
    const signature = sign(body);
    expect(verifyWebhookSignature(Buffer.from(`${body.toString()} `), signature, secret)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body.toString().replace('entry', 'Entry')), signature, secret)).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    const hex = sign(body).slice('sha256='.length);
    for (const header of [undefined, '', hex, `sha1=${hex}`, 'sha256=', 'sha256=zzzz', `sha256=${hex.slice(0, 20)}`, `sha256=${hex}00`]) {
      expect(verifyWebhookSignature(body, header, secret), String(header)).toBe(false);
    }
  });
});

describe('extractStatuses', () => {
  it('reads status updates from a Cloud API webhook payload', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102290129340398',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
                statuses: [
                  { id: 'wamid.ONE', status: 'delivered', timestamp: '1750263773', recipient_id: '919876543210' },
                  {
                    id: 'wamid.TWO',
                    status: 'failed',
                    timestamp: '1750263774',
                    recipient_id: '919876543211',
                    errors: [
                      { code: 131026, title: 'Message undeliverable', error_data: { details: 'Recipient is not a WhatsApp user' } },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extractStatuses(payload)).toEqual([
      { waMessageId: 'wamid.ONE', status: 'delivered', errorCode: null, errorText: null },
      {
        waMessageId: 'wamid.TWO',
        status: 'failed',
        errorCode: '131026',
        errorText: 'Message undeliverable – Recipient is not a WhatsApp user',
      },
    ]);
  });

  it('ignores incoming chat messages, unknown statuses and junk', () => {
    const incoming = { entry: [{ changes: [{ value: { messages: [{ from: '919876543210', text: { body: 'hi' } }] } }] }] };
    expect(extractStatuses(incoming)).toEqual([]);
    expect(extractStatuses({ entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'deleted' }, { status: 'sent' }, 7] } }] }] })).toEqual([]);
    for (const junk of [null, undefined, 'text', 42, [], { entry: 'nope' }]) expect(extractStatuses(junk)).toEqual([]);
  });
});

describe('status ordering', () => {
  it('never lets a status move backwards', () => {
    expect(REPLACEABLE.sent).toEqual(['queued']);
    expect(REPLACEABLE.delivered).not.toContain('read');
    expect(REPLACEABLE.read).toEqual(['queued', 'sent', 'delivered']);
    // a late "failed" cannot overwrite a message that was in fact delivered or read
    expect(REPLACEABLE.failed).toEqual(['queued', 'sent']);
  });
});

describe('shouldAutoPause', () => {
  it('pauses when more than 10% of recent messages failed', () => {
    expect(shouldAutoPause(100, 11)).toBe(true);
    expect(shouldAutoPause(100, 10)).toBe(false); // exactly 10% is still allowed
    expect(shouldAutoPause(20, 3)).toBe(true);
    expect(shouldAutoPause(200, 0)).toBe(false);
  });

  it('waits for a minimum sample so one early failure cannot stop a run', () => {
    expect(shouldAutoPause(1, 1)).toBe(false);
    expect(shouldAutoPause(MIN_SAMPLE - 1, MIN_SAMPLE - 1)).toBe(false);
    expect(shouldAutoPause(MIN_SAMPLE, 2)).toBe(true);
    expect(shouldAutoPause(0, 0)).toBe(false);
  });
});
