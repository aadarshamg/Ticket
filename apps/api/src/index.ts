import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './db';
import { getMessagingIfConfigured, recoverStranded } from './messaging';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Creating the messaging instance connects to Redis and, unless RUN_WORKER=false,
// starts the worker that drains the WhatsApp send queue.
const messaging = getMessagingIfConfigured();
if (messaging) {
  console.log(
    `WhatsApp sending: ${messaging.sender.name} sender, ${env.SEND_RATE_PER_SECOND}/s, worker ${env.RUN_WORKER ? 'in this process' : 'separate'}`,
  );
  if (env.RUN_WORKER) recoverStranded(messaging);
} else {
  console.warn('WhatsApp sending is disabled: REDIS_URL or the WhatsApp settings are missing.');
}

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    // Let the worker finish the messages it is sending before exiting.
    void Promise.allSettled([messaging?.close(), prisma.$disconnect()]).finally(() => process.exit(0));
  });
  // Do not hang forever on open keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
