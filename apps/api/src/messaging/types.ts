/** A WhatsApp template message, independent of which provider delivers it. */
export interface OutboundMessage {
  /** Recipient in E.164, e.g. +919876543210. */
  to: string;
  template: string;
  language: string;
  /** Values for {{1}}, {{2}}, ... in the template body, in order. */
  bodyParams: string[];
  /** Appended to the template's URL button: https://{DOMAIN}/b/<suffix>. */
  buttonUrlSuffix: string;
}

export type SendResult =
  | { ok: true; waMessageId: string }
  | {
      ok: false;
      /** True for problems worth trying again (rate limits, outages); false for ones that will not change. */
      retryable: boolean;
      errorCode: string;
      errorText: string;
    };

/**
 * Anything that can deliver a template message. The Meta Cloud API implementation is
 * CloudApiSender; a BSP such as AiSensy or Interakt can be added by implementing this.
 */
export interface MessageSender {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
