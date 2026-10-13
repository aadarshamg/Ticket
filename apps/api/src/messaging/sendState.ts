import type { Redis } from 'ioredis';

/** Pause when more than this share of recent messages have failed... */
export const FAILURE_RATE_LIMIT = 0.1;
/** ...but only once at least this many have been tried, so one early failure cannot stop a run. */
export const MIN_SAMPLE = 10;

export type PauseReason = 'manual' | 'failure_rate';

export interface RunState {
  paused: boolean;
  pauseReason: PauseReason | null;
  pausedAt: string | null;
  /** The current (or most recent) run of sending. */
  batchId: string | null;
  startedAt: string | null;
  total: number;
  sent: number;
  failed: number;
}

/** Pure rule for the automatic pause. `processed` and `failed` count since the run started or was last resumed. */
export function shouldAutoPause(processed: number, failed: number): boolean {
  return processed >= MIN_SAMPLE && failed / processed > FAILURE_RATE_LIMIT;
}

/**
 * Progress counters and pause state for the send queue, kept in one Redis hash so that
 * every API and worker process sees the same thing.
 */
export class SendState {
  constructor(
    private readonly redis: Redis,
    private readonly key: string,
  ) {}

  async get(): Promise<RunState> {
    const h = await this.redis.hgetall(this.key);
    return {
      paused: h.paused === '1',
      pauseReason: (h.pauseReason as PauseReason | undefined) || null,
      pausedAt: h.pausedAt || null,
      batchId: h.batchId || null,
      startedAt: h.startedAt || null,
      total: Number(h.total ?? 0),
      sent: Number(h.sent ?? 0),
      failed: Number(h.failed ?? 0),
    };
  }

  /**
   * Registers newly queued messages. If the queue was idle this starts a fresh run;
   * otherwise the messages are added to the run in progress.
   */
  async addToRun(batchId: string, count: number, queueIdle: boolean): Promise<void> {
    if (queueIdle) {
      await this.redis
        .multi()
        .hset(this.key, {
          batchId,
          startedAt: new Date().toISOString(),
          total: count,
          sent: 0,
          failed: 0,
          windowProcessed: 0,
          windowFailed: 0,
        })
        .exec();
    } else {
      await this.redis.hincrby(this.key, 'total', count);
    }
  }

  /** Records a message's final outcome. Resolves true if the failure rate now calls for a pause. */
  async recordOutcome(ok: boolean): Promise<boolean> {
    const pipeline = this.redis.multi().hincrby(this.key, ok ? 'sent' : 'failed', 1).hincrby(this.key, 'windowProcessed', 1);
    if (!ok) pipeline.hincrby(this.key, 'windowFailed', 1);
    await pipeline.exec();
    return this.failureRateExceeded();
  }

  /** A message that was accepted earlier has now been reported as failed (delivery webhook). */
  async recordLateFailure(): Promise<boolean> {
    await this.redis.multi().hincrby(this.key, 'sent', -1).hincrby(this.key, 'failed', 1).hincrby(this.key, 'windowFailed', 1).exec();
    return this.failureRateExceeded();
  }

  private async failureRateExceeded(): Promise<boolean> {
    const [processed, failed] = await this.redis.hmget(this.key, 'windowProcessed', 'windowFailed');
    return shouldAutoPause(Number(processed ?? 0), Number(failed ?? 0));
  }

  async setPaused(reason: PauseReason): Promise<void> {
    await this.redis.hset(this.key, { paused: 1, pauseReason: reason, pausedAt: new Date().toISOString() });
  }

  /** Clears the pause and restarts the failure-rate window, so a resume gets a fair fresh sample. */
  async clearPaused(): Promise<void> {
    await this.redis
      .multi()
      .hset(this.key, { paused: 0, windowProcessed: 0, windowFailed: 0 })
      .hdel(this.key, 'pauseReason', 'pausedAt')
      .exec();
  }
}
