import { randomUUID } from 'node:crypto';
import type { MessageSender, OutboundMessage, SendResult } from './types';

export interface WaSarathiConfig {
  /**
   * The "Send Template Message (GET)" link WaSarathi generates for each approved template
   * (API Developer → Generate API End-point), keyed by template name. It looks like
   *   https://<panel>/api/v1/whatsapp/send/template?apiToken=…&phone_number_id=…&template_id=…
   *     &templateVariable-name-1=…&…&templateVariable-code-10=…&phone_number=…
   * The link may hold the account's API token; set `apiToken` instead to keep it out of the link.
   */
  endpoints: Record<string, string | undefined>;
  /** The account's API key. When set, it replaces whatever apiToken the link carries. */
  apiToken?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const VARIABLE_KEY = /^templateVariable-.*-(\d+)$/i;
const RETRYABLE_TEXT = /rate|limit|too many|try again|timeout|timed out|temporar|unavailable|busy/i;

/** A variable with a name like PASSLINK or VIEWURL takes the whole pass link. */
const LINK_VARIABLE = /link|url/i;

/**
 * Fills a generated link for one recipient. The template's variables are numbered in the link
 * in template order (WaSarathi numbers the text variables first, then the button's), so they get
 * the body values in order and then the booking code for a dynamic "View Passes" button. A
 * template that puts the link in its text instead (because its button cannot carry a variable)
 * names that variable for a link, e.g. PASSLINK, and it gets the whole pass link.
 */
export function buildWaSarathiUrl(endpoint: string, message: OutboundMessage, apiToken?: string): URL | { error: string } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { error: `The WaSarathi link for ${message.template} is not a valid web address` };
  }

  const variables = [...url.searchParams.keys()]
    .filter((key) => VARIABLE_KEY.test(key))
    .sort((a, b) => Number(a.match(VARIABLE_KEY)![1]) - Number(b.match(VARIABLE_KEY)![1]));
  // A variable named for a link (PASSLINK) takes the pass link wherever it is in the text; the
  // others take the message's values in order, and without such a variable the last one is the
  // button's booking code.
  const linkKey = variables.find((key) => LINK_VARIABLE.test(key.replace(/^templateVariable-/i, '')));
  const others = variables.filter((key) => key !== linkKey);
  const values = linkKey ? [...message.bodyParams] : [...message.bodyParams, message.buttonUrlSuffix];
  if (others.length !== values.length) {
    return {
      error:
        `The WaSarathi link for ${message.template} has ${variables.length} template variable(s); it needs ${message.bodyParams.length + 1} ` +
        `(${message.bodyParams.length} in the text, then 1 for the passes: the View Passes button's code, or a PASSLINK variable in the text). ` +
        'Check the template matches docs/whatsapp-template.md.',
    };
  }
  others.forEach((key, index) => url.searchParams.set(key, values[index]!));
  if (linkKey) url.searchParams.set(linkKey, message.passUrl);
  if (apiToken) url.searchParams.set('apiToken', apiToken);
  if (!url.searchParams.get('apiToken') || url.searchParams.get('apiToken') === 'XXXX') {
    return { error: 'The WaSarathi API key is missing: set WASARATHI_API_TOKEN' };
  }

  // Recipient: country code and number, digits only. Some panels call it sendToPhoneNumber.
  const recipient = message.to.replace(/\D/g, '');
  const recipientKeys = ['phone_number', 'sendToPhoneNumber'].filter((key) => url.searchParams.has(key));
  for (const key of recipientKeys.length ? recipientKeys : ['phone_number']) url.searchParams.set(key, recipient);
  return url;
}

/** Finds WhatsApp's own message ID ("wamid.…") anywhere in the panel's answer. */
function findMessageId(value: unknown, depth = 0): string | null {
  if (typeof value === 'string') return value.startsWith('wamid.') ? value : null;
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const item of Object.values(value)) {
    const found = findMessageId(item, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Sends template messages through WaSarathi (a BotSailor-style WhatsApp panel). */
export class WaSarathiSender implements MessageSender {
  readonly name = 'wasarathi';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: WaSarathiConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  canSend(template: string): boolean {
    return Boolean(this.config.endpoints[template]);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    const endpoint = this.config.endpoints[message.template];
    if (!endpoint) {
      return {
        ok: false,
        retryable: false,
        errorCode: 'template_not_configured',
        errorText: `No WaSarathi link is set for the ${message.template} template.`,
      };
    }
    const url = buildWaSarathiUrl(endpoint, message, this.config.apiToken);
    if (!(url instanceof URL)) {
      return { ok: false, retryable: false, errorCode: 'template_variables', errorText: url.error.slice(0, 500) };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000) });
    } catch (error) {
      // Could not reach the panel at all (network, DNS, timeout): try again later.
      // Never include the URL in the error: it carries the API token.
      return {
        ok: false,
        retryable: true,
        errorCode: 'network',
        errorText: error instanceof Error ? error.message.slice(0, 500) : 'Network error',
      };
    }

    const text = await response.text().catch(() => '');
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = null;
    }

    // These panels answer 200 even when sending failed, with e.g. {"status":"0","message":"…"}.
    const status = body?.status;
    const failed =
      !response.ok ||
      body === null ||
      status === 0 || status === '0' || status === false || status === 'error' || status === 'failed' ||
      Boolean(body.error);
    if (!failed) {
      return { ok: true, waMessageId: findMessageId(body) ?? `wasarathi.${randomUUID()}` };
    }

    const reason = String(body?.message ?? body?.error ?? text.slice(0, 200) ?? '').trim();
    return {
      ok: false,
      retryable: response.status === 429 || response.status >= 500 || RETRYABLE_TEXT.test(reason),
      errorCode: response.ok ? 'wasarathi_rejected' : `http_${response.status}`,
      errorText: `WaSarathi: ${reason || `responded ${response.status}`}`.slice(0, 500),
    };
  }
}
