import { describe, expect, it } from 'vitest';
import type { OutboundMessage } from '../../src/messaging/types';
import { buildWaSarathiUrl, WaSarathiSender } from '../../src/messaging/wasarathiSender';

const message: OutboundMessage = {
  to: '+919876543210',
  template: 'event_ticket_v1',
  language: 'en',
  bodyParams: ['Asha Rao', 'Winter Music Night', 'Saturday, 14 Nov 2026', '18:00', 'Palace Grounds, Bengaluru', '4', '3,196', 'ORD-1001', 'Sangam Events'],
  buttonUrlSuffix: 'ABCDEFGH2345',
  passUrl: 'https://passes.example.com/b/ABCDEFGH2345',
};

/** A link as WaSarathi generates it: sample values in every variable, variables in any order. */
function generatedLink(variableCount = 10) {
  const url = new URL('https://panel.example/api/v1/whatsapp/send/template');
  url.searchParams.set('apiToken', 'SECRET-TOKEN');
  url.searchParams.set('phone_number_id', '1234567890');
  url.searchParams.set('template_id', '42');
  const names = ['name', 'event', 'date', 'time', 'venue', 'passes', 'amount', 'order', 'organiser', 'code'];
  // Deliberately out of order: the number at the end decides the position, not where it appears.
  for (let n = variableCount; n >= 1; n--) url.searchParams.set(`templateVariable-${names[n - 1] ?? 'x'}-${n}`, 'sample');
  url.searchParams.set('phone_number', '910000000000');
  return url.toString();
}

/** A fetch stand-in that records the request and answers with the given status and body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const sender = (fetchImpl: typeof fetch, endpoint = generatedLink()) =>
  new WaSarathiSender({ endpoints: { event_ticket_v1: endpoint }, fetchImpl });

describe('buildWaSarathiUrl', () => {
  it('fills the variables in number order, then the booking code for the button, and sets the recipient', () => {
    const url = buildWaSarathiUrl(generatedLink(), message) as URL;
    expect(url).toBeInstanceOf(URL);
    expect(url.searchParams.get('templateVariable-name-1')).toBe('Asha Rao');
    expect(url.searchParams.get('templateVariable-venue-5')).toBe('Palace Grounds, Bengaluru');
    expect(url.searchParams.get('templateVariable-organiser-9')).toBe('Sangam Events');
    expect(url.searchParams.get('templateVariable-code-10')).toBe('ABCDEFGH2345');
    expect(url.searchParams.get('phone_number')).toBe('919876543210'); // digits only, no +
    // Everything else stays as generated.
    expect(url.searchParams.get('apiToken')).toBe('SECRET-TOKEN');
    expect(url.searchParams.get('template_id')).toBe('42');
  });

  it('refuses a link whose template has a different number of variables', () => {
    const result = buildWaSarathiUrl(generatedLink(9), message);
    expect(result).toEqual({ error: expect.stringContaining('has 9 template variable(s) for the message details; it needs 10') });
  });
});

describe('WaSarathiSender', () => {
  it('calls the filled link and returns WhatsApp’s message ID when the panel gives one', async () => {
    const { impl, calls } = fakeFetch(200, { status: '1', message: 'Message sent', data: { wa_message_id: 'wamid.ABC123' } });
    const result = await sender(impl).send(message);

    expect(result).toEqual({ ok: true, waMessageId: 'wamid.ABC123' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe('GET');
    expect(new URL(calls[0]!.url).searchParams.get('phone_number')).toBe('919876543210');
  });

  it('makes up a unique ID when the panel does not return one', async () => {
    const { impl } = fakeFetch(200, { status: 'success', message: 'Queued' });
    const first = await sender(impl).send(message);
    const second = await sender(impl).send(message);
    expect(first.ok && first.waMessageId.startsWith('wasarathi.')).toBe(true);
    expect(first.ok && second.ok && first.waMessageId !== second.waMessageId).toBe(true);
  });

  it('reads a failure the panel reports with status 200', async () => {
    const { impl } = fakeFetch(200, { status: '0', message: 'Invalid template' });
    expect(await sender(impl).send(message)).toEqual({
      ok: false,
      retryable: false,
      errorCode: 'wasarathi_rejected',
      errorText: 'WaSarathi: Invalid template',
    });
  });

  it('treats rate limits, outages and network errors as temporary', async () => {
    const limited = await sender(fakeFetch(200, { status: '0', message: 'Rate limit exceeded, try again later' }).impl).send(message);
    expect(limited).toMatchObject({ ok: false, retryable: true });

    const outage = await sender(fakeFetch(503, 'Service Unavailable').impl).send(message);
    expect(outage).toMatchObject({ ok: false, retryable: true, errorCode: 'http_503' });

    const unreachable = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await sender(unreachable).send(message)).toMatchObject({ ok: false, retryable: true, errorCode: 'network' });
  });

  it('never puts the link (which holds the API token) into an error', async () => {
    const results = await Promise.all([
      sender(fakeFetch(500, 'oops').impl).send(message),
      sender(fakeFetch(200, { status: '0' }).impl).send(message),
      sender(fakeFetch(200, 'not json').impl).send(message),
    ]);
    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
    }
  });

  it('uses the API key from its own setting, so the link need not contain it', async () => {
    const link = generatedLink().replace('SECRET-TOKEN', 'XXXX');
    const withKey = buildWaSarathiUrl(link, message, 'REAL-KEY') as URL;
    expect(withKey.searchParams.get('apiToken')).toBe('REAL-KEY');
    expect(buildWaSarathiUrl(link, message)).toEqual({ error: 'The WaSarathi API key is missing: set WASARATHI_API_TOKEN' });
  });

  it('puts the whole pass link into a variable named for a link, wherever it is in the text', () => {
    const link = generatedLink(9) + '&templateVariable-PASSLINK-10=sample';
    const middle = buildWaSarathiUrl(generatedLink(9).replace('templateVariable-organiser-9', 'templateVariable-PASSLINK-9') + '&templateVariable-thanks-10=x', message) as URL;
    expect(middle.searchParams.get('templateVariable-PASSLINK-9')).toBe('https://passes.example.com/b/ABCDEFGH2345');
    expect(middle.searchParams.get('templateVariable-thanks-10')).toBe('Sangam Events');
    const url = buildWaSarathiUrl(link, message) as URL;
    expect(url.searchParams.get('templateVariable-PASSLINK-10')).toBe('https://passes.example.com/b/ABCDEFGH2345');
    expect(url.searchParams.get('templateVariable-organiser-9')).toBe('Sangam Events');
  });

  it('fills every PASSCODE variable with the booking code: one in the text and one in the button', () => {
    // Nine message details, then PASSCODE in the text (10) and again in the button (11), as WaSarathi generates it.
    const link = generatedLink(9) + '&templateVariable-PASSCODE-10=sample&templateVariable-PASSCODE-11=sample';
    const url = buildWaSarathiUrl(link, message) as URL;
    expect(url.searchParams.get('templateVariable-organiser-9')).toBe('Sangam Events');
    expect(url.searchParams.get('templateVariable-PASSCODE-10')).toBe('ABCDEFGH2345');
    expect(url.searchParams.get('templateVariable-PASSCODE-11')).toBe('ABCDEFGH2345');
    // A single PASSCODE in the button works the same way.
    const single = buildWaSarathiUrl(generatedLink(9) + '&templateVariable-PASSCODE-10=x', message) as URL;
    expect(single.searchParams.get('templateVariable-PASSCODE-10')).toBe('ABCDEFGH2345');
  });

  it('fails without calling out when the template has no link or the wrong variables', async () => {
    const { impl, calls } = fakeFetch(200, { status: '1' });
    expect(await sender(impl).send({ ...message, template: 'event_reminder_v1' })).toMatchObject({
      ok: false,
      retryable: false,
      errorCode: 'template_not_configured',
    });
    expect(await sender(impl, generatedLink(3)).send(message)).toMatchObject({ ok: false, errorCode: 'template_variables' });
    expect(calls).toHaveLength(0);
    expect(sender(impl).canSend('event_ticket_v1')).toBe(true);
    expect(sender(impl).canSend('event_reminder_v1')).toBe(false);
  });
});
