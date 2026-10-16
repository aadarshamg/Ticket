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
  /** The whole link to the booking's passes, for templates that carry it in their text. */
  passUrl: string;
  /**
   * The same values as bodyParams, by the variable names a panel such as WaSarathi uses
   * (BUYER, DATE, ORDERID...), so a template may leave some out or put them in another order.
   */
  namedParams?: Record<string, string>;
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
 * CloudApiSender; WaSarathiSender goes through the WaSarathi panel. Another BSP can be added by
 * implementing this.
 */
export interface MessageSender {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
  /** False when this provider has no set-up for the template; absent means every template works. */
  canSend?(template: string): boolean;
}
