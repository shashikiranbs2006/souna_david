import { describe, expect, it } from 'vitest';
import { isAutomatedClient, visitorPrefix } from '../../src/domain/sharing.ts';

describe('visitorPrefix', () => {
  it('shortens IPv4 to /24 and strips a CloudFront port', () => {
    expect(visitorPrefix({ forwardedFor: '203.0.113.77, 10.0.0.1' })).toBe('203.0.113.0/24');
    expect(visitorPrefix({ cloudfront: '203.0.113.77:51234' })).toBe('203.0.113.0/24');
  });
  it('shortens IPv6 to the first three real groups, also when written with "::"', () => {
    expect(visitorPrefix({ forwardedFor: '2001:db8:1:2:3:4:5:6' })).toBe('2001:db8:1::/48');
    expect(visitorPrefix({ forwardedFor: '2001::db8:1' })).toBe('2001:0:0::/48');
    expect(visitorPrefix({ cloudfront: '[2001:db8:abcd::1]:443' })).toBe('2001:db8:abcd::/48');
    expect(visitorPrefix({ forwardedFor: '::1' })).toBe('0:0:0::/48');
  });
  it('gives null for nothing or garbage', () => {
    expect(visitorPrefix({})).toBeNull();
    expect(visitorPrefix({ forwardedFor: 'not-an-ip:zz' })).toBeNull();
  });
});

describe('isAutomatedClient', () => {
  it('flags previews, crawlers and missing agents, not browsers', () => {
    for (const ua of [undefined, 'WhatsApp/2.23', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'curl/8.4.0', 'Microsoft Office/16.0 (Outlook)']) expect(isAutomatedClient(ua)).toBe(true);
    for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120']) expect(isAutomatedClient(ua)).toBe(false);
  });
});
