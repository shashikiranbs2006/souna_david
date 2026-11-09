import { beforeEach, describe, expect, it } from 'vitest';
import { IdpError } from '../../../src/adapters/errors.ts';
import { LocalIdentityProvider } from '../../../src/adapters/idp/local.ts';
import { base32Decode } from '../../../src/adapters/idp/base32.ts';
import { totp } from '../../../src/adapters/idp/totp.ts';
import type { AuthResult, ClientMetadata, MailMessage, Mailer, Tokens } from '../../../src/adapters/types.ts';
import { FakeIdpDb } from './fake-idp-db.ts';

const meta: ClientMetadata = {
  resellerId: '0b9a0f7e-1111-4222-8333-944455556666',
  brandName: 'Alpha Spa',
  primaryColor: '#2a6f4e',
  storefrontUrl: 'https://alpha.example.com',
  supportEmail: 'help@alpha.example.com',
  locale: 'de',
};

class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
    return { messageId: String(this.sent.length) };
  }
}

let clock: Date;
let db: FakeIdpDb;
let mailer: CapturingMailer;
let idp: LocalIdentityProvider;

const make = (staffMfa: 'REQUIRED' | 'OPTIONAL' = 'REQUIRED') =>
  new LocalIdentityProvider({ tx: db.tx, mailer, jwtSecret: 'test-jwt-secret-0123456789abcdefghijkl', staffMfa, now: () => clock });

const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof IdpError) return e.code;
    throw e;
  }
  return 'OK';
}

const tokensOf = (r: AuthResult): Tokens => {
  if (r.kind !== 'TOKENS') throw new Error(`expected tokens, got ${r.challenge}`);
  return r.tokens;
};
const sessionOf = (r: AuthResult, challenge: string): string => {
  if (r.kind !== 'CHALLENGE' || r.challenge !== challenge) throw new Error(`expected ${challenge}`);
  return r.session;
};

beforeEach(() => {
  clock = new Date('2026-10-23T10:00:00Z');
  db = new FakeIdpDb(() => clock);
  mailer = new CapturingMailer();
  idp = make();
});

const STAFF_EMAIL = 'owner@alpha.example.com';
const STAFF_PASSWORD = 'Staff-Secret-123';

/** Creates a staff user and walks the first sign-in (the policy must be OPTIONAL for plain tokens). */
async function signInStaff(): Promise<Tokens> {
  const { temporaryPassword } = await idp.adminCreateUser('STAFF', { username: STAFF_EMAIL, email: STAFF_EMAIL, clientMetadata: meta });
  const np = sessionOf(await idp.initiateAuth('STAFF', STAFF_EMAIL, temporaryPassword), 'NEW_PASSWORD_REQUIRED');
  return tokensOf(await idp.respondNewPassword('STAFF', np, STAFF_PASSWORD));
}

describe('LocalIdentityProvider: sessions', () => {
  let tokens: Tokens;
  beforeEach(async () => {
    idp = make('OPTIONAL');
    tokens = await signInStaff();
  });

  it('issues short-lived access tokens that only verify as STAFF', async () => {
    expect(tokens.expiresIn).toBe(900);
    const verified = await idp.verifyAccessToken('STAFF', tokens.accessToken);
    expect(verified).toMatchObject({ pool: 'STAFF', username: STAFF_EMAIL, exp: Math.floor(clock.getTime() / 1000) + 900 });
    expect(await codeOf(idp.verifyAccessToken('STAFF', `${tokens.accessToken}x`))).toBe('SESSION_EXPIRED');
  });

  it('never reveals whether a user exists', async () => {
    expect(await codeOf(idp.initiateAuth('STAFF', STAFF_EMAIL, 'Wrong-Password-1'))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(idp.initiateAuth('STAFF', 'nobody', 'Wrong-Password-1'))).toBe('INVALID_CREDENTIALS');
  });

  it('rotates, and reuse of a rotated token revokes the whole family', async () => {
    const second = await idp.refresh('STAFF', tokens.refreshToken);
    expect(second.refreshToken).not.toBe(tokens.refreshToken);
    const third = await idp.refresh('STAFF', second.refreshToken);
    expect(await codeOf(idp.refresh('STAFF', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.refresh('STAFF', third.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('two tabs refreshing with the same token within 15 s both get the same successor', async () => {
    const first = await idp.refresh('STAFF', tokens.refreshToken);
    advance(14_000);
    const second = await idp.refresh('STAFF', tokens.refreshToken);
    expect(second).toEqual(first);
    // The successor stays usable and rotates normally.
    const third = await idp.refresh('STAFF', first.refreshToken);
    expect(third.refreshToken).not.toBe(first.refreshToken);
  });

  it('keeps successors only encrypted', async () => {
    const next = await idp.refresh('STAFF', tokens.refreshToken);
    const attrs = JSON.stringify([...db.state.users.values()][0]!.attributes);
    expect(attrs).toContain('idp:refresh_grace');
    expect(attrs).not.toContain(next.refreshToken);
    expect(attrs).not.toContain(next.accessToken);
  });

  it('outside the window reuse still revokes the family', async () => {
    const next = await idp.refresh('STAFF', tokens.refreshToken);
    advance(15_001);
    expect(await codeOf(idp.refresh('STAFF', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.refresh('STAFF', next.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('the window does not revive a logged-out or disabled session', async () => {
    const next = await idp.refresh('STAFF', tokens.refreshToken);
    await idp.revoke('STAFF', next.refreshToken);
    expect(await codeOf(idp.refresh('STAFF', tokens.refreshToken))).toBe('SESSION_EXPIRED');

    const fresh = tokensOf(await idp.initiateAuth('STAFF', STAFF_EMAIL, STAFF_PASSWORD));
    await idp.refresh('STAFF', fresh.refreshToken);
    await idp.adminDisableUser('STAFF', STAFF_EMAIL);
    expect(await codeOf(idp.refresh('STAFF', fresh.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('a stale grace entry for a successor that was rotated again counts as reuse', async () => {
    const second = await idp.refresh('STAFF', tokens.refreshToken);
    const third = await idp.refresh('STAFF', second.refreshToken);
    expect(await codeOf(idp.refresh('STAFF', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.refresh('STAFF', third.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('expires after 30 days, not extended by rotation', async () => {
    advance(29 * 24 * 3600 * 1000);
    const next = await idp.refresh('STAFF', tokens.refreshToken);
    advance(2 * 24 * 3600 * 1000);
    expect(await codeOf(idp.refresh('STAFF', next.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('revoke ends the session family; unknown tokens are ignored', async () => {
    const next = await idp.refresh('STAFF', tokens.refreshToken);
    await idp.revoke('STAFF', next.refreshToken);
    expect(await codeOf(idp.refresh('STAFF', next.refreshToken))).toBe('SESSION_EXPIRED');
    await expect(idp.revoke('STAFF', 'nonsense')).resolves.toBeUndefined();
  });

  it('disable blocks sign-in and refresh; enable restores the account', async () => {
    await idp.adminDisableUser('STAFF', STAFF_EMAIL);
    expect(await codeOf(idp.initiateAuth('STAFF', STAFF_EMAIL, STAFF_PASSWORD))).toBe('ACCOUNT_DISABLED');
    expect(await codeOf(idp.refresh('STAFF', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    await idp.adminEnableUser('STAFF', STAFF_EMAIL);
    tokensOf(await idp.initiateAuth('STAFF', STAFF_EMAIL, STAFF_PASSWORD));
    expect(await codeOf(idp.adminDisableUser('STAFF', 'nobody'))).toBe('NOT_FOUND');
  });
});

describe('LocalIdentityProvider: staff with TOTP', () => {
  const email = 'owner@alpha.example.com';
  const adminMeta = { ...meta, storefrontUrl: 'https://alpha.example.com/admin', locale: 'it' };
  const now = () => Math.floor(clock.getTime() / 1000);

  async function invite() {
    const { temporaryPassword } = await idp.adminCreateUser('STAFF', { username: email, email, attributes: { name: 'Olivia' }, clientMetadata: adminMeta });
    return temporaryPassword;
  }

  async function enrol(): Promise<string> {
    const temp = await invite();
    const np = sessionOf(await idp.initiateAuth('STAFF', email, temp), 'NEW_PASSWORD_REQUIRED');
    const setup = sessionOf(await idp.respondNewPassword('STAFF', np, 'Staff-Secret-123'), 'MFA_SETUP');
    const assoc = await idp.associateSoftwareToken('STAFF', setup);
    expect(assoc.otpauthUri).toContain(`secret=${assoc.secret}`);
    expect(await codeOf(idp.verifySoftwareToken('STAFF', setup, '000000'))).toBe('CHALLENGE_EXPIRED'); // old session is gone
    const secret = base32Decode(assoc.secret);
    tokensOf({ kind: 'TOKENS', tokens: await idp.verifySoftwareToken('STAFF', assoc.session, totp(secret, now())) });
    return assoc.secret;
  }

  it('mails a localised invitation with the temporary password', async () => {
    const temp = await invite();
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe(email);
    expect(mail.subject).toBe('È stato invitato su Alpha Spa');
    expect(mail.text).toContain(temp);
    expect(mail.html).toContain('https://alpha.example.com/admin');
  });

  it('walks NEW_PASSWORD_REQUIRED → MFA_SETUP → tokens, then requires TOTP', async () => {
    const secret = base32Decode(await enrol());
    advance(60_000);
    const mfa = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    expect(await codeOf(idp.respondMfa('STAFF', mfa, '000000'))).toBe('MFA_INVALID');
    const code = totp(secret, now());
    const tokens = await idp.respondMfa('STAFF', mfa, code);
    expect((await idp.verifyAccessToken('STAFF', tokens.accessToken)).username).toBe(email);
    // The same code cannot be replayed on a new login.
    const again = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    expect(await codeOf(idp.respondMfa('STAFF', again, code))).toBe('MFA_INVALID');
    // A consumed session cannot be used twice.
    expect(await codeOf(idp.respondMfa('STAFF', mfa, code))).toBe('CHALLENGE_EXPIRED');
  });

  it('rejects forged, expired and exhausted sessions', async () => {
    const secret = base32Decode(await enrol());
    advance(60_000);
    const mfa = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    const [id] = mfa.split('.');
    expect(await codeOf(idp.respondMfa('STAFF', `${id}.forged`, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
    for (let i = 0; i < 5; i++) await codeOf(idp.respondMfa('STAFF', mfa, '000000'));
    expect(await codeOf(idp.respondMfa('STAFF', mfa, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
    const late = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    advance(5 * 60_000 + 1);
    expect(await codeOf(idp.respondMfa('STAFF', late, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
  });

  it('temporary passwords expire after 7 days', async () => {
    const temp = await invite();
    advance(7 * 24 * 3600 * 1000 + 1);
    expect(await codeOf(idp.initiateAuth('STAFF', email, temp))).toBe('INVALID_CREDENTIALS');
  });

  it('with an OPTIONAL policy staff without TOTP get tokens directly', async () => {
    idp = make('OPTIONAL');
    const temp = await invite();
    const np = sessionOf(await idp.initiateAuth('STAFF', email, temp), 'NEW_PASSWORD_REQUIRED');
    tokensOf(await idp.respondNewPassword('STAFF', np, 'Staff-Secret-123'));
  });

  it('generates a policy-compliant temporary password when none is given', async () => {
    const temp = await invite();
    expect(temp).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{10,}$/);
  });
});
