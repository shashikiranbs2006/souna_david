import { z } from 'zod';
import { email, password, uuid } from './common.ts';

export const sessionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anonymous'), csrfToken: z.string() }),
  z.object({
    kind: z.literal('staff'),
    csrfToken: z.string(),
    staff: z.object({
      id: uuid,
      email: z.string(),
      displayName: z.string(),
      role: z.enum(['OWNER', 'ADMIN']),
    }),
  }),
]);
export type Session = z.infer<typeof sessionSchema>;

/** Staff sign-in follows Cognito's challenge model: password, then TOTP (or its setup). */
export const staffLoginRequest = z.object({ email, password: z.string().min(1).max(256) });
export const staffChallengeResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK') }),
  z.object({ status: z.literal('MFA_REQUIRED'), challengeId: z.string() }),
  z.object({ status: z.literal('MFA_SETUP'), challengeId: z.string(), secret: z.string(), otpauthUri: z.string() }),
  z.object({ status: z.literal('NEW_PASSWORD_REQUIRED'), challengeId: z.string() }),
]);
export type StaffChallengeResponse = z.infer<typeof staffChallengeResponse>;
export const staffMfaRequest = z.object({ challengeId: z.string().max(200), code: z.string().trim().regex(/^\d{6}$/) });
export const staffNewPasswordRequest = z.object({ challengeId: z.string().max(200), newPassword: password });
