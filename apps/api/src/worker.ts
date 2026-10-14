/**
 * Runs only the WhatsApp send worker, for deployments that keep it separate from the API
 * (set RUN_WORKER=false on the API instances and start this with `npm run worker`).
 */
import { env } from './config/env';
import { prisma } from './db';
import { getSender, recoverStranded } from './messaging';
import { Messaging } from './messaging/messaging';

if (!env.REDIS_URL) {
  throw new Error('REDIS_URL is required to run the send worker.');
}

const messaging = new Messaging({
  redisUrl: env.REDIS_URL,
  prefix: env.QUEUE_PREFIX,
  sender: getSender(),
  ratePerSecond: env.SEND_RATE_PER_SECOND,
  retryBaseMs: env.SEND_RETRY_BASE_MS,
  runWorker: true,
});
console.log(`Send worker started: ${messaging.sender.name} sender, ${env.SEND_RATE_PER_SECOND}/s`);
recoverStranded(messaging);

function shutdown(signal: string) {
  console.log(`${signal} received, finishing current messages`);
  void Promise.allSettled([messaging.close(), prisma.$disconnect()]).finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
