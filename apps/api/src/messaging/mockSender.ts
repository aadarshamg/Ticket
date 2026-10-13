import { randomUUID } from 'node:crypto';
import { maskPhone } from '../lib/phone';
import type { MessageSender, OutboundMessage, SendResult } from './types';

/**
 * Stands in for WhatsApp in development and tests: nothing leaves the machine.
 * Each "sent" message is logged (with the phone number masked) and kept in memory.
 */
export class MockSender implements MessageSender {
  readonly name = 'mock';
  /** The most recent messages, newest last. */
  readonly sent: OutboundMessage[] = [];

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message);
    if (this.sent.length > 1000) this.sent.shift();
    this.log(
      `[mock WhatsApp] ${message.template} to ${maskPhone(message.to)} · button /b/${message.buttonUrlSuffix}`,
    );
    return { ok: true, waMessageId: `mock.${randomUUID()}` };
  }
}
