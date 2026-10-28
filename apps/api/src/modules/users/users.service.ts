import { Prisma } from '@prisma/client';
import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  BulkStatusInput,
  BulkStatusResult,
  ChangePasswordInput,
  Me,
  Paginated,
  UpdateProfileInput,
  UserListQuery,
  UserSummary,
} from '@vtmp/shared';
import { hashPassword, verifyPassword } from '../../core/auth';
import { withAudit, type Actor } from '../../core/audit';
import { prisma } from '../../core/db';
import { AppError } from '../../core/errors';
import { paginated, parsePagination } from '../../core/http';
import { getMe, revokeUserSessions } from '../auth/auth.service';
import { batchesOnlyTaughtBy } from '../batches/batches.service';

/** D3: refuse to deactivate the only trainer of a planned or running batch. */
async function assertNoBatchLeftWithoutTrainer(userIds: string[]): Promise<void> {
  const stranded = await batchesOnlyTaughtBy(userIds);
  if (stranded.length === 0) return;
  throw AppError.conflict(
    'TRAINER_STILL_NEEDED',
    `Assign another trainer first: ${stranded.map((s) => `${s.trainerName} is the only trainer of ${s.batch}`).join('; ')}`,
    stranded.map((s) => ({ path: s.trainerName, message: s.batch })),
  );
}

// ─── Self-service (BRQ-1.3) ──────────────────────────────────────────────────

export async function updateProfile(
  actor: Actor & { userId: string },
  input: UpdateProfileInput,
): Promise<Me> {
  const userId = actor.userId;
  await withAudit(actor, async (tx, log) => {
    const before = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        fullName: true,
        locale: true,
        student: { select: { id: true, phone: true, nameOdia: true } },
        trainer: { select: { id: true, phone: true } },
      },
    });
    const { phone, nameOdia, ...userFields } = input;
    if (nameOdia !== undefined && !before.student) {
      throw AppError.unprocessable('STUDENTS_ONLY', 'Only students have an Odia name', [
        { path: 'nameOdia', message: 'Students only' },
      ]);
    }
    if (Object.keys(userFields).length) {
      await tx.user.update({ where: { id: userId }, data: userFields });
    }
    if (nameOdia !== undefined && before.student) {
      await tx.student.update({
        where: { id: before.student.id },
        data: { nameOdia: nameOdia || null },
      });
    }
    if (phone !== undefined) {
      if (before.student)
        await tx.student.update({ where: { id: before.student.id }, data: { phone } });
      else if (before.trainer)
        await tx.trainer.update({ where: { id: before.trainer.id }, data: { phone } });
    }
    await log({
      action: 'USER_PROFILE_UPDATED',
      entity: 'User',
      entityId: userId,
      oldValue: {
        fullName: before.fullName,
        locale: before.locale,
        phone: before.student?.phone ?? before.trainer?.phone ?? null,
        ...(before.student ? { nameOdia: before.student.nameOdia } : {}),
      },
      newValue: input,
    });
  });
  return getMe(userId);
}

export async function changePassword(
  actor: Actor & { userId: string },
  input: ChangePasswordInput,
  currentRefreshToken?: string,
): Promise<void> {
  const user = await prisma().user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw AppError.unprocessable('INVALID_CURRENT_PASSWORD', 'Current password is incorrect', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }
  const passwordHash = await hashPassword(input.newPassword);
  await withAudit(actor, async (tx, log) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: { passwordHash, mustChangePassword: false },
    });
    // Sign out every other device; keep the session that made the change.
    await revokeUserSessions(tx, actor.userId, currentRefreshToken);
    // Never put password material in the audit log.
    await log({ action: 'USER_PASSWORD_CHANGED', entity: 'User', entityId: actor.userId });
  });
}

// ─── Admin user management ───────────────────────────────────────────────────

const summarySelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  locale: true,
  isActive: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  student: { select: { rollNo: true } },
  trainer: { select: { employeeCode: true } },
} satisfies Prisma.UserSelect;

type SummaryRow = Prisma.UserGetPayload<{ select: typeof summarySelect }>;

function toSummary(u: SummaryRow): UserSummary {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    locale: u.locale,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    rollNo: u.student?.rollNo ?? null,
    employeeCode: u.trainer?.employeeCode ?? null,
  };
}

export async function listUsers(query: UserListQuery): Promise<Paginated<UserSummary>> {
  const page = parsePagination(query);
  const q = query.q;
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { fullName: { contains: q, mode: 'insensitive' } },
            { student: { rollNo: { contains: q, mode: 'insensitive' } } },
            { trainer: { employeeCode: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma().$transaction([
    prisma().user.findMany({
      where,
      select: summarySelect,
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma().user.count({ where }),
  ]);
  return paginated(rows.map(toSummary), total, page);
}

function conflictFromUnique(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const target = String((err.meta?.target as string[] | string | undefined) ?? '');
    if (target.includes('roll_no'))
      throw AppError.conflict('ROLL_NO_TAKEN', 'Roll number is already in use');
    if (target.includes('employee_code'))
      throw AppError.conflict('EMPLOYEE_CODE_TAKEN', 'Employee code is already in use');
    throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists');
  }
  throw err;
}

export async function createUser(actor: Actor, input: AdminCreateUserInput): Promise<UserSummary> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await withAudit(actor, async (tx, log) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          locale: input.locale,
          passwordHash,
          mustChangePassword: input.mustChangePassword ?? false,
          ...(input.role === 'STUDENT'
            ? {
                student: {
                  create: {
                    rollNo: input.rollNo,
                    cgpa: new Prisma.Decimal(input.cgpa),
                    phone: input.phone ?? null,
                  },
                },
              }
            : {}),
          ...(input.role === 'TRAINER'
            ? {
                trainer: {
                  create: {
                    employeeCode: input.employeeCode,
                    specialization: input.specialization ?? null,
                    phone: input.phone ?? null,
                  },
                },
              }
            : {}),
        },
        select: summarySelect,
      });
      const { password: _password, ...safe } = input;
      await log({ action: 'USER_CREATED', entity: 'User', entityId: user.id, newValue: safe });
      return toSummary(user);
    });
  } catch (err) {
    conflictFromUnique(err);
  }
}

export async function updateUser(
  actor: Actor & { userId: string },
  userId: string,
  input: AdminUpdateUserInput,
): Promise<UserSummary> {
  if (userId === actor.userId && input.isActive === false) {
    throw AppError.conflict('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
  }
  if (input.isActive === false) await assertNoBatchLeftWithoutTrainer([userId]);
  return withAudit(actor, async (tx, log) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: summarySelect });
    if (!before) throw AppError.notFound('User not found');
    const reactivating = input.isActive === true && !before.isActive;
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        ...input,
        // Reactivation also clears any login lock so the user can sign in straight away.
        ...(reactivating ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
      select: summarySelect,
    });
    if (input.isActive === false) await revokeUserSessions(tx, userId);
    const action =
      input.isActive === false
        ? 'USER_DEACTIVATED'
        : reactivating
          ? 'USER_REACTIVATED'
          : 'USER_UPDATED';
    await log({
      action,
      entity: 'User',
      entityId: userId,
      oldValue: { fullName: before.fullName, isActive: before.isActive, locale: before.locale },
      newValue: input,
    });
    return toSummary(user);
  });
}

/**
 * Sets a new password for a user who forgot theirs (the sign-in page sends them to the training
 * office). It also clears any login lock and ends every session, so only the new password works
 * from now on. Admins change their own password under /users/me/password instead.
 */
export async function resetPassword(
  actor: Actor & { userId: string },
  userId: string,
  password: string,
  mustChangePassword = true,
): Promise<UserSummary> {
  if (userId === actor.userId) {
    throw AppError.conflict(
      'CANNOT_RESET_OWN_PASSWORD',
      'Change your own password from your profile instead',
    );
  }
  const passwordHash = await hashPassword(password);
  return withAudit(actor, async (tx, log) => {
    const before = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!before) throw AppError.notFound('User not found');
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword, failedLoginCount: 0, lockedUntil: null },
      select: summarySelect,
    });
    await revokeUserSessions(tx, userId);
    // Never the password itself (CLAUDE.md rule 10).
    await log({
      action: 'USER_PASSWORD_RESET',
      entity: 'User',
      entityId: userId,
      newValue: { mustChangePassword },
    });
    return toSummary(user);
  });
}

/** Clears a login lock (too many wrong passwords) so the user can try again at once (A2). */
export async function unlockUser(actor: Actor, userId: string): Promise<UserSummary> {
  return withAudit(actor, async (tx, log) => {
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { lockedUntil: true, failedLoginCount: true },
    });
    if (!before) throw AppError.notFound('User not found');
    const user = await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
      select: summarySelect,
    });
    await log({
      action: 'USER_UNLOCKED',
      entity: 'User',
      entityId: userId,
      oldValue: {
        lockedUntil: before.lockedUntil?.toISOString() ?? null,
        failedLoginCount: before.failedLoginCount,
      },
    });
    return toSummary(user);
  });
}

/**
 * Deactivates or reactivates several accounts in one transaction (admin clean-up). The same
 * rules as one at a time: never yourself, deactivation ends sessions, reactivation unlocks.
 */
export async function setUsersActive(
  actor: Actor & { userId: string },
  input: BulkStatusInput,
): Promise<BulkStatusResult> {
  if (!input.isActive && input.ids.includes(actor.userId)) {
    throw AppError.conflict('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
  }
  if (!input.isActive) await assertNoBatchLeftWithoutTrainer(input.ids);
  return withAudit(actor, async (tx, log) => {
    const before = await tx.user.findMany({
      where: { id: { in: input.ids } },
      select: { id: true, isActive: true },
    });
    if (before.length !== input.ids.length) throw AppError.notFound('User not found');
    const ids = before.filter((u) => u.isActive !== input.isActive).map((u) => u.id);
    if (ids.length === 0) return { updated: 0 };
    await tx.user.updateMany({
      where: { id: { in: ids } },
      data: {
        isActive: input.isActive,
        ...(input.isActive ? { failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    if (!input.isActive) for (const id of ids) await revokeUserSessions(tx, id);
    await log.many(
      ids.map((id) => ({
        action: input.isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        entity: 'User',
        entityId: id,
        oldValue: { isActive: !input.isActive },
        newValue: { isActive: input.isActive },
      })),
    );
    return { updated: ids.length };
  });
}

const userInUse = () =>
  AppError.conflict(
    'USER_IN_USE',
    'This account already has activity (applications, training records or actions), so it cannot be deleted. Deactivate it instead.',
  );

/**
 * Permanently removes an account that has no history yet (e.g. created by mistake). Sessions,
 * notifications and idempotency keys go with it; anything else keeps the account, which can
 * then only be deactivated. The references below would be silently set to NULL by the
 * database, so they are checked first; every other reference blocks the delete itself.
 */
export async function deleteUser(actor: Actor & { userId: string }, userId: string): Promise<void> {
  if (userId === actor.userId) {
    throw AppError.conflict('CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }
  try {
    await withAudit(actor, async (tx, log) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          ...summarySelect,
          trainer: { select: { employeeCode: true, _count: { select: { sessions: true } } } },
          _count: {
            select: {
              enrollmentDecisions: true,
              settingsUpdated: true,
              ratingsVerified: true,
              ratingsRevoked: true,
              resourcesApproved: true,
              materialsApproved: true,
            },
          },
        },
      });
      if (!user) throw AppError.notFound('User not found');
      const nulled = Object.values(user._count).reduce((a, b) => a + b, 0);
      if (nulled + (user.trainer?._count.sessions ?? 0) > 0) throw userInUse();
      await tx.student.deleteMany({ where: { userId } });
      await tx.trainer.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      await log({
        action: 'USER_DELETED',
        entity: 'User',
        entityId: userId,
        oldValue: {
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          rollNo: user.student?.rollNo ?? null,
          employeeCode: user.trainer?.employeeCode ?? null,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw userInUse();
    }
    throw err;
  }
}

/** Active accounts per role (admin dashboard, BRQ-9.1). */
export async function activeCounts(): Promise<{ students: number; trainers: number }> {
  const rows = await prisma().user.groupBy({
    by: ['role'],
    where: { isActive: true },
    _count: { _all: true },
  });
  const of = (role: string) => rows.find((r) => r.role === role)?._count._all ?? 0;
  return { students: of('STUDENT'), trainers: of('TRAINER') };
}

/** Public-safe identity of a student (passport): name, roll number and optional photo only. */
export async function studentProfile(
  studentId: string,
): Promise<{ id: string; fullName: string; rollNo: string; photoUrl: string | null } | null> {
  const s = await prisma().student.findUnique({
    where: { id: studentId },
    select: { id: true, rollNo: true, photoUrl: true, user: { select: { fullName: true } } },
  });
  return s ? { id: s.id, fullName: s.user.fullName, rollNo: s.rollNo, photoUrl: s.photoUrl } : null;
}

/** Names and roll numbers for a set of students (lists in other modules). */
export async function studentSummaries(
  ids: string[],
): Promise<
  Map<string, { id: string; fullName: string; rollNo: string; userId: string; isActive: boolean }>
> {
  if (ids.length === 0) return new Map();
  const rows = await prisma().student.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      rollNo: true,
      userId: true,
      user: { select: { fullName: true, isActive: true } },
    },
  });
  return new Map(
    rows.map((s) => [
      s.id,
      {
        id: s.id,
        fullName: s.user.fullName,
        rollNo: s.rollNo,
        userId: s.userId,
        isActive: s.user.isActive,
      },
    ]),
  );
}

/** Display names for a set of users. */
export async function userNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma().user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true },
  });
  return new Map(rows.map((u) => [u.id, u.fullName]));
}

/** Active administrators (escalation notices, action owners). */
export async function activeAdmins(): Promise<Array<{ id: string; fullName: string }>> {
  return prisma().user.findMany({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true },
  });
}

/** Name and email for a set of users (audit viewer). */
export async function userIdentities(
  ids: string[],
): Promise<Map<string, { id: string; fullName: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma().user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, fullName: true, email: true },
  });
  return new Map(rows.map((u) => [u.id, u]));
}

/** A student by roll number (case-insensitive), for staff lookups such as placements. */
export async function studentByRollNo(
  rollNo: string,
): Promise<{ id: string; fullName: string; rollNo: string } | null> {
  const s = await prisma().student.findFirst({
    where: { rollNo: { equals: rollNo.trim(), mode: 'insensitive' } },
    select: { id: true, rollNo: true, user: { select: { fullName: true } } },
  });
  return s ? { id: s.id, fullName: s.user.fullName, rollNo: s.rollNo } : null;
}
