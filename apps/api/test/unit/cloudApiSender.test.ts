import { describe, expect, it } from 'vitest';
import { buildCloudApiPayload, classifyCloudApiError, CloudApiSender } from '../../src/messaging/cloudApiSender';
import { MockSender } from '../../src/messaging/mockSender';
import type { OutboundMessage } from '../../src/messaging/types';

const message: OutboundMessage = {
  to: '+919876543210',
  template: 'event_ticket_v1',
  language: 'en',
  bodyParams: ['Asha Rao', 'Winter Music Night', 'Saturday, 14 Nov 2026', '18:00', 'Palace Grounds, Bengaluru', '4', '3,196', 'ORD-1001', 'Sangam Events'],
  buttonUrlSuffix: 'ABCDEFGH2345',
};

/** A fetch stand-in that records the request and answers with the given status and JSON. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

const sender = (fetchImpl: typeof fetch) =>
  new CloudApiSender({ phoneNumberId: '1234567890', accessToken: 'TOKEN', graphVersion: 'v23.0', fetchImpl });

describe('buildCloudApiPayload', () => {
  it('builds a template message with nine body values and the URL button suffix', () => {
    expect(buildCloudApiPayload(message)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210', // no leading +
      type: 'template',
      template: {
        name: 'event_ticket_v1',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: message.bodyParams.map((text) => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'ABCDEFGH2345' }] },
        ],
      },
    });
  });
});

describe('CloudApiSender', () => {
  it('posts to the phone number’s messages endpoint with the bearer token and returns the message ID', async () => {
    const { impl, calls } = fakeFetch(200, { messages: [{ id: 'wamid.ABC123' }] });
    const result = await sender(impl).send(message);

    expect(result).toEqual({ ok: true, waMessageId: 'wamid.ABC123' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer TOKEN', 'Content-Type': 'application/json' });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(buildCloudApiPayload(message));
  });

  it('treats rate limits and outages as temporary', async () => {
    const rateLimited = fakeFetch(429, { error: { code: 130429, message: 'Rate limit hit' } });
    expect(await sender(rateLimited.impl).send(message)).toEqual({
      ok: false,
      retryable: true,
      errorCode: '130429',
      errorText: 'Rate limit hit',
    });
    const down = fakeFetch(503, {});
    expect(await sender(down.impl).send(message)).toMatchObject({ ok: false, retryable: true, errorCode: 'http_503' });
  });

  it('treats a bad number, a missing template and an expired token as permanent', async () => {
    const undeliverable = fakeFetch(400, {
      error: { code: 131026, message: 'Message undeliverable', error_data: { details: 'Recipient is not on WhatsApp' } },
    });
    expect(await sender(undeliverable.impl).send(message)).toEqual({
      ok: false,
      retryable: false,
      errorCode: '131026',
      errorText: 'Message undeliverable – Recipient is not on WhatsApp',
    });
    expect(classifyCloudApiError(404, { code: 132001, message: 'Template does not exist' })).toMatchObject({ retryable: false });
    expect(classifyCloudApiError(401, { code: 190, message: 'Access token expired' })).toMatchObject({ retryable: false });
  });

  it('treats a network failure as temporary', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await sender(offline).send(message)).toEqual({
      ok: false,
      retryable: true,
      errorCode: 'network',
      errorText: 'fetch failed',
    });
  });

  it('does not report success without a message ID', async () => {
    const odd = fakeFetch(200, { messages: [] });
    expect(await sender(odd.impl).send(message)).toMatchObject({ ok: false });
  });
});

describe('MockSender', () => {
  it('records the message and logs it without the full phone number', async () => {
    const lines: string[] = [];
    const mock = new MockSender((line) => lines.push(line));
    const result = await mock.send(message);

    expect(result.ok && result.waMessageId.startsWith('mock.')).toBe(true);
    expect(mock.sent).toEqual([message]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('event_ticket_v1');
    expect(lines[0]).toContain('3210');
    expect(lines[0]).not.toContain('98765');
    expect(lines[0]).not.toContain('Asha');
  });
});
