import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuthSession, LoginInput, Me } from '@vtmp/shared';
import {
  REFRESH_TOKEN_TTL_MS,
  burnPasswordCheck,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../../core/auth';
import { withAudit } from '../../core/audit';
import { prisma, type Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { logger } from '../../core/logger';
import { settings } from '../../core/settings';

const meSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  locale: true,
  mustChangePassword: true,
  student: { select: { id: true, rollNo: true, cgpa: true, phone: true, nameOdia: true } },
  trainer: { select: { id: true, employeeCode: true, phone: true, specialization: true } },
} satisfies Prisma.UserSelect;

type MeRow = Prisma.UserGetPayload<{ select: typeof meSelect }>;

export function toMe(u: MeRow): Me {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    locale: u.locale,
    mustChangePassword: u.mustChangePassword,
    student: u.student ? { ...u.student, cgpa: u.student.cgpa.toFixed(2) } : null,
    trainer: u.trainer,
  };
}

export async function getMe(userId: string): Promise<Me> {
  const user = await prisma().user.findUnique({ where: { id: userId }, select: meSelect });
  if (!user) throw AppError.notFound('User not found');
  return toMe(user);
}

export interface IssuedSession {
  session: AuthSession;
  /** Raw refresh token for the httpOnly cookie. Never logged or returned in the body. */
  refreshToken: string;
}

// One answer for every failed sign-in, locked accounts included (A5): a different answer for a
// locked account would tell anyone that the email exists. The message names the lock so a
// real user knows to wait (or to ask an admin to unlock it).
const invalidCredentials = () =>
  new AppError(
    401,
    'INVALID_CREDENTIALS',
    'Invalid email or password, or the account is locked for a few minutes after too many tries',
  );

async function issueSession(
  tx: Tx,
  user: MeRow,
  familyId?: string,
): Promise<IssuedSession & { tokenId: string }> {
  const { raw, hash } = generateRefreshToken();
  const created = await tx.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      // A new login starts a family; rotation keeps it so reuse can revoke every descendant.
      familyId: familyId ?? randomUUID(),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  const access = signAccessToken(user);
  return {
    session: { accessToken: access.token, expiresIn: access.expiresIn, user: toMe(user) },
    refreshToken: raw,
    tokenId: created.id,
  };
}

/** BRQ-1.1 with lockout after auth.maxFailedLogins failures for auth.lockMinutes (TAD §9). */
export async function login(input: LoginInput, ip?: string): Promise<IssuedSession> {
  const user = await prisma().user.findUnique({
    where: { email: input.email },
    select: {
      ...meSelect,
      passwordHash: true,
      isActive: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    await burnPasswordCheck(input.password);
    throw invalidCredentials();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    // Same cost and answer as a wrong password; the password is not checked while locked.
    await burnPasswordCheck(input.password);
    throw invalidCredentials();
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    await recordFailedLogin(user.id, user.failedLoginCount, ip);
    throw invalidCredentials();
  }
  // Deactivated accounts get the same answer as a wrong password.
  if (!user.isActive) throw invalidCredentials();

  return prisma().$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const { session, refreshToken } = await issueSession(tx, user);
    return { session, refreshToken };
  });
}

async function recordFailedLogin(userId: string, previousFailures: number, ip?: string) {
  const { 'auth.maxFailedLogins': maxFailed, 'auth.lockMinutes': lockMinutes } =
    await settings.getMany(['auth.maxFailedLogins', 'auth.lockMinutes'] as const);
  const failures = previousFailures + 1;

  if (failures < maxFailed) {
    await prisma().user.update({ where: { id: userId }, data: { failedLoginCount: failures } });
    return;
  }
  const lockedUntil = new Date(Date.now() + lockMinutes * 60_000);
  await withAudit({ userId: null, ip }, async (tx, log) => {
    await tx.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil } });
    await log({
      action: 'USER_LOCKED',
      entity: 'User',
      entityId: userId,
      newValue: { lockedUntil, failures },
    });
  });
}

/**
 * Rotates the refresh token. Presenting a token that was already rotated or revoked means it
 * leaked: the whole family is revoked and the caller must sign in again.
 */
export async function refresh(rawToken: string | undefined): Promise<IssuedSession> {
  if (!rawToken) throw new AppError(401, 'NO_REFRESH_TOKEN', 'Please sign in');
  const token = await prisma().refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: { select: { ...meSelect, isActive: true } } },
  });
  if (!token) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Please sign in again');

  if (token.revokedAt) {
    await revokeFamily(token.familyId);
    logger.warn({ userId: token.userId, familyId: token.familyId }, 'refresh token reuse detected');
    throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Please sign in again');
  }
  if (token.expiresAt <= new Date() || !token.user.isActive) {
    await revokeFamily(token.familyId);
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Please sign in again');
  }

  return prisma().$transaction(async (tx) => {
    // Conditional update closes the race where two requests rotate the same token at once.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0)
      throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Please sign in again');

    const issued = await issueSession(tx, token.user, token.familyId);
    await tx.refreshToken.update({
      where: { id: token.id },
      data: { replacedById: issued.tokenId },
    });
    return { session: issued.session, refreshToken: issued.refreshToken };
  });
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const token = await prisma().refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    select: { familyId: true },
  });
  if (token) await revokeFamily(token.familyId);
}

async function revokeFamily(familyId: string): Promise<void> {
  await prisma().refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every session of a user, optionally keeping the family of the current one. */
export async function revokeUserSessions(
  client: Tx,
  userId: string,
  keepFamilyOf?: string,
): Promise<void> {
  let keepFamilyId: string | undefined;
  if (keepFamilyOf) {
    const current = await client.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(keepFamilyOf) },
      select: { familyId: true, userId: true },
    });
    if (current?.userId === userId) keepFamilyId = current.familyId;
  }
  await client.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(keepFamilyId ? { NOT: { familyId: keepFamilyId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}
