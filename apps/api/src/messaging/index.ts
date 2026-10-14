import { TICKET_TEMPLATE } from '../config/constants';
import { env } from '../config/env';
import { HttpError } from '../middleware/errors';
import { CloudApiSender } from './cloudApiSender';
import { Messaging } from './messaging';
import { MockSender } from './mockSender';
import { REMINDER_TEMPLATE } from './templates';
import type { MessageSender } from './types';
import { WaSarathiSender } from './wasarathiSender';

let sender: MessageSender | undefined;
let messaging: Messaging | undefined;

/** The configured provider: MockSender unless MESSAGE_SENDER is cloud or wasarathi. */
export function getSender(): MessageSender {
  if (sender) return sender;
  if (env.MESSAGE_SENDER === 'cloud') {
    if (!env.WA_PHONE_NUMBER_ID || !env.WA_ACCESS_TOKEN) {
      throw new HttpError(
        503,
        'sending_not_configured',
        'WhatsApp is not set up: WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN are missing.',
      );
    }
    sender = new CloudApiSender({
      phoneNumberId: env.WA_PHONE_NUMBER_ID,
      accessToken: env.WA_ACCESS_TOKEN,
      graphVersion: env.WA_GRAPH_VERSION,
    });
  } else if (env.MESSAGE_SENDER === 'wasarathi') {
    if (!env.WASARATHI_TICKET_URL) {
      throw new HttpError(503, 'sending_not_configured', 'WhatsApp is not set up: WASARATHI_TICKET_URL is missing.');
    }
    sender = new WaSarathiSender({
      endpoints: { [TICKET_TEMPLATE]: env.WASARATHI_TICKET_URL, [REMINDER_TEMPLATE]: env.WASARATHI_REMINDER_URL },
    });
  } else {
    sender = new MockSender();
  }
  return sender;
}

/** The send queue, created on first use. Throws 503 if Redis is not configured. */
export function getMessaging(): Messaging {
  if (messaging) return messaging;
  if (!env.REDIS_URL) {
    throw new HttpError(503, 'sending_not_configured', 'Sending is not set up: REDIS_URL is missing.');
  }
  messaging = new Messaging({
    redisUrl: env.REDIS_URL,
    prefix: env.QUEUE_PREFIX,
    sender: getSender(),
    ratePerSecond: env.SEND_RATE_PER_SECOND,
    retryBaseMs: env.SEND_RETRY_BASE_MS,
    runWorker: env.RUN_WORKER,
  });
  return messaging;
}

/** The send queue if it has been created or can be; null when sending is not configured. */
export function getMessagingIfConfigured(): Messaging | null {
  try {
    return getMessaging();
  } catch {
    return null;
  }
}

/** At start-up: puts back in the queue any messages a Redis restart left waiting. Never throws. */
export function recoverStranded(instance: Messaging): void {
  instance
    .recoverStranded()
    .then((count) => {
      if (count > 0) console.log(`Re-queued ${count} message(s) that were waiting when Redis restarted.`);
    })
    .catch((error: unknown) => console.error('Could not check for waiting messages:', error));
}

/** Tests install their own queue and fake sender here. */
export function setMessaging(instance: Messaging | undefined): void {
  messaging = instance;
  sender = instance?.sender;
}
