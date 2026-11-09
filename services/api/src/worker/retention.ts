import type { Pool } from 'pg';
import type { Logger } from '../lib/log.ts';
import { errorKind } from './sanitize.ts';
import { workerTx } from './tx.ts';

/**
 * Retention jobs (design 15.3, review G3). Every job deletes in short batches, each in its own
 * transaction, so locks stay brief and a backlog never blocks writers. The append-only tables go
 * through the SECURITY DEFINER function `retention_delete_batch`.
 */

export interface RetentionOptions {
  pool: Pool;
  log: Logger;
  now?: () => Date;
  /** Rows per DELETE statement. */
  batchSize?: number;
}

export interface RetentionCounts {
  shareLinkViews: number;
  shareLinkActivity: number;
  auditEvents: number;
}

export interface RetentionResult extends RetentionCounts {
  /** Jobs that threw; the others still ran. The next run retries. */
  failedJobs: string[];
}

type JobKey = keyof RetentionCounts;

/** Retention periods (proposed defaults, to confirm with counsel), in calendar terms. */
export const RETENTION = {
  shareLinkViews: { months: 13 },
  shareLinkActivity: { months: 13 },
  auditEvents: { months: 24 },
} as const satisfies Record<JobKey, { days: number } | { months: number }>;

/** `now` minus a calendar period (UTC). */
export function cutoffFor(now: Date, period: { days: number } | { months: number }): Date {
  const d = new Date(now);
  if ('months' in period) d.setUTCMonth(d.getUTCMonth() - period.months);
  else d.setUTCDate(d.getUTCDate() - period.days);
  return d;
}

const TABLES = { shareLinkViews: 'share_link_views', shareLinkActivity: 'share_link_activity', auditEvents: 'audit_events' } as const;

export async function runRetention(opts: RetentionOptions): Promise<RetentionResult> {
  const now = (opts.now ?? (() => new Date()))();
  const batchSize = opts.batchSize ?? 5000;
  const counts: RetentionCounts = { shareLinkViews: 0, shareLinkActivity: 0, auditEvents: 0 };
  const failedJobs: string[] = [];

  for (const key of Object.keys(TABLES) as JobKey[]) {
    try {
      counts[key] = await deleteViaFunction(opts.pool, TABLES[key], cutoffFor(now, RETENTION[key]), batchSize);
    } catch (err) {
      // One failing job must not stop the others; the next run retries.
      failedJobs.push(key);
      opts.log.error('retention.job_failed', { job: key, error: errorKind(err) });
    }
  }

  opts.log.info('retention.done', { ...counts, failedJobs });
  return { ...counts, failedJobs };
}

async function deleteViaFunction(pool: Pool, table: (typeof TABLES)[JobKey], cutoff: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await workerTx(pool, async db => {
      const { rows } = await db.query<{ n: number }>('SELECT retention_delete_batch($1, $2, $3) AS n', [table, cutoff, batchSize]);
      return Number(rows[0]?.n ?? 0);
    });
    total += n;
    if (n < batchSize) return total;
  }
}
