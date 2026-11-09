import { runRetention, type RetentionOptions } from './retention.ts';
import { errorKind } from './sanitize.ts';

export interface LocalWorkerOptions {
  /** Retention interval; 0 disables it. */
  retentionIntervalMs?: number;
  /** Run retention once at start-up. */
  retentionOnStart?: boolean;
}

export interface LocalWorker {
  /** Stops the timer and waits for a running retention job to finish. */
  stop(): Promise<void>;
}

/** Background retention for the single local server process: runs hourly, never overlapping. */
export function startLocalWorker(deps: Pick<RetentionOptions, 'pool' | 'log' | 'now'>, opts: LocalWorkerOptions = {}): LocalWorker {
  const retentionMs = opts.retentionIntervalMs ?? 3_600_000;
  let stopped = false;
  let running: Promise<void> | null = null;

  const run = (): void => {
    if (stopped || running) return;
    running = runRetention(deps)
      .then(() => undefined)
      .catch(err => deps.log.error('worker.local_retention_failed', { error: errorKind(err) }))
      .finally(() => {
        running = null;
      });
  };

  const timer = retentionMs > 0 ? setInterval(run, retentionMs) : null;
  timer?.unref?.();
  if (opts.retentionOnStart) run();
  deps.log.info('worker.local_started', { retentionIntervalMs: retentionMs });

  return {
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      await running;
    },
  };
}
