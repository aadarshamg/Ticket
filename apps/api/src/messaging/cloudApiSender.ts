import type { MessageSender, OutboundMessage, SendResult } from './types';

export interface CloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  /** e.g. "v23.0" */
  graphVersion: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface GraphError {
  message?: string;
  code?: number;
  error_data?: { details?: string };
}

/**
 * Meta error codes that are worth retrying: rate limits and temporary outages.
 * Everything else (bad number, template problems, expired token...) will fail again the same way.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const RETRYABLE_CODES = new Set([
  1, // unknown API error
  2, // service temporarily unavailable
  4, // app-level rate limit
  80007, // WhatsApp Business Account rate limit
  130429, // Cloud API throughput limit
  131000, // something went wrong
  131016, // service unavailable
  131048, // spam rate limit
  131056, // too many messages to this recipient in a short time
  133004, // server temporarily unavailable
]);

/** The JSON body for POST /{phone-number-id}/messages. */
export function buildCloudApiPayload(message: OutboundMessage) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: message.to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: message.template,
      language: { code: message.language },
      components: [
        {
          type: 'body',
          parameters: message.bodyParams.map((text) => ({ type: 'text', text })),
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: message.buttonUrlSuffix }],
        },
      ],
    },
  };
}

/** Turns a failed Cloud API response into a SendResult, deciding whether a retry could help. */
export function classifyCloudApiError(httpStatus: number, error: GraphError | undefined): SendResult {
  const code = error?.code;
  const retryable =
    httpStatus === 429 || httpStatus >= 500 || (code !== undefined && RETRYABLE_CODES.has(code));
  const text = [error?.message, error?.error_data?.details].filter(Boolean).join(' – ');
  return {
    ok: false,
    retryable,
    errorCode: code !== undefined ? String(code) : `http_${httpStatus}`,
    errorText: (text || `WhatsApp API responded ${httpStatus}`).slice(0, 500),
  };
}

/** Sends template messages through the Meta WhatsApp Cloud API. */
export class CloudApiSender implements MessageSender {
  readonly name = 'cloud';
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: CloudApiConfig) {
    this.url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildCloudApiPayload(message)),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch (error) {
      // Could not reach Meta at all (network, DNS, timeout): try again later.
      return {
        ok: false,
        retryable: true,
        errorCode: 'network',
        errorText: error instanceof Error ? error.message.slice(0, 500) : 'Network error',
      };
    }

    const body = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: GraphError;
    } | null;

    const id = body?.messages?.[0]?.id;
    if (response.ok && id) return { ok: true, waMessageId: id };
    return classifyCloudApiError(response.status, body?.error);
  }
}
