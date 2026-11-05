import { describe, expect, it } from 'vitest';
import { scoreShare } from '../../src/domain/likelihood.ts';
import { visitorPrefix } from '../../src/domain/sharing.ts';

const at = (iso: string) => new Date(iso);
const base = { sentAt: at('2026-11-01T10:00:00Z'), expiresAt: at('2026-11-20T10:00:00Z'), now: at('2026-11-05T10:00:00Z') };

describe('scoreShare', () => {
  it('is NONE for a fresh unopened link', () => {
    expect(scoreShare({ ...base, now: at('2026-11-01T12:00:00Z'), views: [], activity: [] })).toMatchObject({ level: 'NONE', points: 0 });
  });
  it('penalises a link nobody opened for three days', () => {
    const r = scoreShare({ ...base, views: [], activity: [] });
    expect(r.reasons).toEqual([{ code: 'NOT_OPENED', points: -20 }]);
    expect(r.level).toBe('LOW');
  });
  it('rewards quick opens, returns, the inside view, long visits and a second network', () => {
    const r = scoreShare({
      ...base,
      views: [
        { viewedAt: at('2026-11-01T11:00:00Z'), visitor: '1.2.3.0/24' },
        { viewedAt: at('2026-11-02T09:00:00Z'), visitor: '1.2.3.0/24' },
        { viewedAt: at('2026-11-03T09:00:00Z'), visitor: '5.6.7.0/24' },
      ],
      activity: [{ insideView: true, seconds: 200 }],
    });
    expect(r.reasons.map(x => x.code)).toEqual(['OPENED', 'RETURNED', 'INSIDE_VIEW', 'LONG_VISIT', 'MULTIPLE_VISITORS', 'OPENED_QUICKLY']);
    expect(r.points).toBe(95);
    expect(r.level).toBe('HIGH');
  });
  it('caps return-visit points at 30 and the total at 100', () => {
    const views = ['01', '02', '03', '04', '05'].map(d => ({ viewedAt: at(`2026-11-${d}T11:00:00Z`), visitor: null }));
    expect(scoreShare({ ...base, views, activity: [] }).reasons.find(x => x.code === 'RETURNED')?.points).toBe(30);
  });
  it('flags an unopened link about to expire', () => {
    const r = scoreShare({ ...base, expiresAt: at('2026-11-07T10:00:00Z'), views: [], activity: [] });
    expect(r.reasons.map(x => x.code)).toEqual(['NOT_OPENED', 'EXPIRING_UNOPENED']);
  });
});

describe('visitorPrefix', () => {
  it('shortens addresses', () => {
    expect(visitorPrefix({ forwardedFor: '203.0.113.77, 10.0.0.1' })).toBe('203.0.113.0/24');
    expect(visitorPrefix({ cloudfront: '203.0.113.77:51234' })).toBe('203.0.113.0/24');
    expect(visitorPrefix({ cloudfront: '2001:db8:abcd:12:1:2:3:4:4433' })).toBe('2001:db8:abcd::/48');
    expect(visitorPrefix({})).toBeNull();
  });
});
