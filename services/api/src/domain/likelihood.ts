/**
 * How likely a sent quote is to sell: plain points with reasons, no model (docs/david-fork-plan.md
 * section 6). A hint for the shop owner, not a forecast. Every number below is a starting point to
 * tune with real outcomes.
 */
export type Likelihood = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type LikelihoodReason =
  | 'OPENED' | 'RETURNED' | 'INSIDE_VIEW' | 'LONG_VISIT' | 'MULTIPLE_VISITORS' | 'OPENED_QUICKLY' | 'NOT_OPENED' | 'EXPIRING_UNOPENED';

export interface ShareSignals {
  /** When the link was created (= sent). */
  sentAt: Date;
  expiresAt: Date;
  now: Date;
  views: { viewedAt: Date; visitor: string | null }[];
  activity: { insideView: boolean; seconds: number }[];
}
export interface LikelihoodResult {
  points: number;
  level: Likelihood;
  reasons: { code: LikelihoodReason; points: number }[];
}

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function scoreShare(s: ShareSignals): LikelihoodResult {
  const reasons: LikelihoodResult['reasons'] = [];
  const add = (code: LikelihoodReason, points: number) => reasons.push({ code, points });
  const opened = s.views.length > 0;

  if (opened) {
    add('OPENED', 20);
    const days = new Set(s.views.map(v => dayKey(v.viewedAt)));
    const laterDays = Math.max(0, days.size - 1);
    if (laterDays > 0) add('RETURNED', Math.min(30, 15 * laterDays));
    if (s.activity.some(a => a.insideView)) add('INSIDE_VIEW', 10);
    if (s.activity.some(a => a.seconds > 120)) add('LONG_VISIT', 10);
    const visitors = new Set(s.views.map(v => v.visitor).filter((v): v is string => Boolean(v)));
    if (visitors.size > 1) add('MULTIPLE_VISITORS', 15);
    const first = Math.min(...s.views.map(v => v.viewedAt.getTime()));
    if (first - s.sentAt.getTime() <= DAY) add('OPENED_QUICKLY', 10);
  } else {
    const age = s.now.getTime() - s.sentAt.getTime();
    if (age > 3 * DAY) add('NOT_OPENED', -20);
    const left = s.expiresAt.getTime() - s.now.getTime();
    if (left > 0 && left <= 3 * DAY) add('EXPIRING_UNOPENED', -10);
  }

  const points = Math.max(0, Math.min(100, reasons.reduce((n, r) => n + r.points, 0)));
  const level: Likelihood = !opened && points === 0 && reasons.length === 0 ? 'NONE' : points >= 60 ? 'HIGH' : points >= 30 ? 'MEDIUM' : 'LOW';
  return { points, level, reasons };
}
