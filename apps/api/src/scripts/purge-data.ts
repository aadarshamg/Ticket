/**
 * Deletes all booking data once it is no longer needed: bookings, passes, WhatsApp message
 * records, scan records and uploads, plus identifying details in the audit log.
 * Run it 30 days after the event (see README > Data protection).
 *
 *   npm run purge-data                       shows what would be deleted; changes nothing
 *   npm run purge-data -- --confirm          deletes, if 30 days have passed since the event ended
 *   npm run purge-data -- --confirm --force  deletes even if it is not due yet
 */
import { env } from '../config/env';
import { prisma } from '../db';
import { Messaging } from '../messaging/messaging';
import { MockSender } from '../messaging/mockSender';
import { planPurge, purgeBookingData, RETENTION_DAYS } from '../services/purge';

const confirm = process.argv.includes('--confirm');
const force = process.argv.includes('--force');
const date = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : 'unknown');

async function main() {
  const plan = await planPurge();
  const { counts } = plan;

  console.log(`Event: ${plan.eventName ?? '(not set up)'}`);
  console.log(`Ended: ${date(plan.eventEndedAt)}   Purge due from: ${date(plan.dueAt)} (${RETENTION_DAYS} days after the end)`);
  console.log('');
  console.log(`  ${counts.bookings} bookings`);
  console.log(`  ${counts.passes} passes`);
  console.log(`  ${counts.messages} WhatsApp message records`);
  console.log(`  ${counts.checkins} scan records`);
  console.log(`  ${counts.uploads} uploads`);
  console.log(`  ${counts.auditEntriesScrubbed} audit entries to strip of identifying details`);
  console.log('');

  if (!confirm) {
    console.log('Nothing was changed. This was a preview.');
    console.log('To delete permanently, export the CSV first if you need a record, then run:');
    console.log('  npm run purge-data -- --confirm');
    return;
  }
  if (!plan.due && !force) {
    console.log(`Not deleted: the purge is not due until ${date(plan.dueAt)}.`);
    console.log('To delete now anyway, add --force.');
    process.exitCode = 1;
    return;
  }

  const done = await purgeBookingData();
  // Messages still waiting in the send queue point at bookings that no longer exist.
  // (No worker is started here: this script must never send anything.)
  if (env.REDIS_URL) {
    const messaging = new Messaging({
      redisUrl: env.REDIS_URL,
      prefix: env.QUEUE_PREFIX,
      sender: new MockSender(),
      ratePerSecond: 1,
      retryBaseMs: 1000,
      runWorker: false,
    });
    await messaging.reset().catch(() => console.warn('The send queue could not be cleared (is Redis running?).'));
    await messaging.close().catch(() => undefined);
  }
  console.log(
    `Deleted ${done.bookings} bookings, ${done.passes} passes, ${done.messages} message records, ` +
      `${done.checkins} scan records and ${done.uploads} uploads; ${done.auditEntriesScrubbed} audit entries scrubbed.`,
  );
  console.log('Event settings, gates and admin logins were kept. This cannot be undone.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
