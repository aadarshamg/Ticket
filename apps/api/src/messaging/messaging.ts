import type { Event } from '@prisma/client';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { SendState, type PauseReason } from './sendState';
import { buildReminderMessage, buildTicketMessage, REMINDER_TEMPLATE } from './templates';
import type { MessageSender, SendResult } from './types';

export interface MessagingOptions {
  redisUrl: string;
  /** Namespace for all keys in Redis. */
  prefix: string;
  sender: MessageSender;
  ratePerSecond: number;
  /** Delay before the first retry of a temporary error; doubles for each further retry. */
  retryBaseMs: number;
  /** Process the queue in this process. False for an API instance when a separate worker runs. */
  runWorker: boolean;
  /** Messages in flight at once. Defaults to the send rate (between 5 and 50). */
  concurrency?: number;
}

interface SendJob {
  messageId: string;
}

const QUEUE_NAME = 'whatsapp-send';
/** One first try plus up to three retries of temporary errors. */
export const MAX_ATTEMPTS = 4;
const EVENT_CACHE_MS = 30_000;

/**
 * The WhatsApp send queue: a BullMQ queue plus (optionally) the worker that drains it.
 *
 * The database is the source of truth for each message's status; Redis holds only the
 * jobs waiting to run and the progress counters. A job is just a Message ID: the worker
 * re-reads the booking when it runs, so edits made after queueing are respected.
 */
export class Messaging {
  readonly sender: MessageSender;
  private readonly queue: Queue<SendJob>;
  private readonly worker?: Worker<SendJob>;
  private readonly redis: Redis;
  private readonly state: SendState;
  private cachedEvent?: { event: Event | null; at: number };

  constructor(options: MessagingOptions) {
    this.sender = options.sender;
    // family 0: look up both IPv4 and IPv6 addresses. Some hosts' private networks (Railway's,
    // for one) are IPv6-only, and Redis clients otherwise try IPv4 only.
    const connection = { url: options.redisUrl, family: 0 };

    this.redis = new Redis(options.redisUrl, { maxRetriesPerRequest: 2, family: 0 });
    this.redis.on('error', (error) => console.error('Redis error:', error.message));
    this.state = new SendState(this.redis, `${options.prefix}:send-state`);

    this.queue = new Queue<SendJob>(QUEUE_NAME, {
      connection,
      prefix: options.prefix,
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: options.retryBaseMs },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    this.queue.on('error', (error) => console.error('Send queue error:', error.message));

    if (options.runWorker) {
      this.worker = new Worker<SendJob>(QUEUE_NAME, (job) => this.process(job), {
        connection,
        prefix: options.prefix,
        // The limiter caps how many messages start each second; concurrency is how many may be
        // in flight at once. Each one waits on the database and the WhatsApp API, so allow as
        // many in flight as start per second or the target rate cannot be reached.
        concurrency: options.concurrency ?? Math.min(50, Math.max(5, options.ratePerSecond)),
        limiter: { max: options.ratePerSecond, duration: 1000 },
      });
      this.worker.on('error', (error) => console.error('Send worker error:', error.message));
    }
  }

  /** Throws if Redis cannot be reached. */
  async ping(): Promise<void> {
    await this.redis.ping();
  }

  /** Adds messages (already saved with status "queued") to the queue. */
  async enqueue(messageIds: string[], batchId: string): Promise<void> {
    if (messageIds.length === 0) return;
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
    const idle = Object.values(counts).every((count) => count === 0);
    await this.state.addToRun(batchId, messageIds.length, idle);
    for (let i = 0; i < messageIds.length; i += 500) {
      await this.queue.addBulk(
        messageIds.slice(i, i + 500).map((messageId) => ({ name: 'send', data: { messageId } })),
      );
    }
  }

  /**
   * Re-queues messages the database says are waiting to be sent but Redis has no job for.
   * That happens when Redis restarts without keeping its data (free Redis plans often do not).
   * Only runs when the queue is completely empty, so it can never queue a message twice; the
   * worker re-checks each message's status before sending in any case.
   */
  async recoverStranded(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
    if (Object.values(counts).some((count) => count > 0)) return 0;
    const stranded = await prisma.message.findMany({ where: { status: 'queued' }, select: { id: true } });
    if (stranded.length === 0) return 0;
    await this.enqueue(
      stranded.map((message) => message.id),
      `recovered-${Date.now()}`,
    );
    return stranded.length;
  }

  async pause(reason: PauseReason): Promise<void> {
    await this.queue.pause();
    await this.state.setPaused(reason);
  }

  async resume(): Promise<void> {
    await this.state.clearPaused();
    await this.queue.resume();
  }

  async status() {
    const [run, counts] = await Promise.all([
      this.state.get(),
      this.queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized'),
    ]);
    const pending = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { ...run, pending, sender: this.sender.name };
  }

  /** Called when a delivery report says an already-accepted message failed. */
  async recordLateFailure(): Promise<void> {
    if (await this.state.recordLateFailure()) await this.autoPause();
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    this.redis.disconnect();
  }

  /** Test helper: removes every job and counter under this prefix. */
  async reset(): Promise<void> {
    await this.queue.obliterate({ force: true });
    await this.redis.del(`${this.queue.opts.prefix}:send-state`);
  }

  private async getEvent(): Promise<Event | null> {
    if (!this.cachedEvent || Date.now() - this.cachedEvent.at > EVENT_CACHE_MS) {
      this.cachedEvent = { event: await prisma.event.findUnique({ where: { id: 1 } }), at: Date.now() };
    }
    return this.cachedEvent.event;
  }

  private async autoPause(): Promise<void> {
    const { paused } = await this.state.get();
    if (paused) return;
    await this.pause('failure_rate');
    await audit(prisma, { type: 'system', label: 'send worker' }, 'send.auto_pause', undefined, {
      reason: 'More than 10% of recent messages failed',
    });
    console.warn('Sending paused automatically: more than 10% of recent messages failed.');
  }

  /** Records the final result of a message (sent, or failed for good) and checks the failure rate. */
  private async finish(messageId: string, result: SendResult): Promise<void> {
    await prisma.message.updateMany({
      where: { id: messageId, status: 'queued' },
      data: result.ok
        ? { status: 'sent', waMessageId: result.waMessageId, attempts: { increment: 1 }, errorCode: null, errorText: null }
        : { status: 'failed', attempts: { increment: 1 }, errorCode: result.errorCode, errorText: result.errorText },
    });
    if (await this.state.recordOutcome(result.ok)) await this.autoPause();
  }

  private async process(job: Job<SendJob>): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: job.data.messageId },
      include: { ticket: true },
    });
    // Deleted, or already handled by an earlier job: nothing to do.
    if (!message || message.status !== 'queued') return;

    const permanent = (errorCode: string, errorText: string): SendResult => ({ ok: false, retryable: false, errorCode, errorText });
    const event = await this.getEvent();

    let result: SendResult;
    if (!event) {
      result = permanent('not_configured', 'Event settings are missing');
    } else if (message.ticket.status === 'cancelled') {
      result = permanent('cancelled', 'Booking was cancelled before the message was sent');
    } else {
      const outbound =
        message.template === REMINDER_TEMPLATE
          ? buildReminderMessage(
              event,
              message.ticket,
              await prisma.pass.count({ where: { ticketId: message.ticketId, status: 'valid' } }),
            )
          : buildTicketMessage(event, message.ticket);
      try {
        result = await this.sender.send(outbound);
      } catch (error) {
        result = { ok: false, retryable: true, errorCode: 'sender_error', errorText: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    if (result.ok) return this.finish(message.id, result);

    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (!result.retryable || lastAttempt) {
      await this.finish(message.id, result);
      // Tells BullMQ not to retry.
      throw new UnrecoverableError(result.errorText);
    }

    // Temporary problem: note it and let BullMQ retry with exponential backoff.
    await prisma.message.updateMany({
      where: { id: message.id, status: 'queued' },
      data: { attempts: { increment: 1 }, errorCode: result.errorCode, errorText: result.errorText },
    });
    throw new Error(result.errorText);
  }
}
