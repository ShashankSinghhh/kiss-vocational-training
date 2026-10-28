import type { RequestHandler } from 'express';
import type { Role } from '@vtmp/shared';
import { prisma } from '../db';
import { AppError } from '../errors';
import { verifyAccessToken } from './tokens';

/**
 * What a user whose password an admin set may still do before choosing their own (A3): see who
 * they are, change the password or language, and load the notification bell of the page.
 */
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set([
  'GET /api/v1/auth/me',
  'POST /api/v1/users/me/password',
  'PATCH /api/v1/users/me',
  'GET /api/v1/notifications/me',
]);

/**
 * Verifies the Bearer access token and loads the user. The DB lookup means deactivation and
 * role changes take effect on the next request rather than when the token expires.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(AppError.unauthorized());

  let claims;
  try {
    claims = verifyAccessToken(header.slice('Bearer '.length).trim());
  } catch (err) {
    return next(err);
  }

  prisma()
    .user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        role: true,
        locale: true,
        isActive: true,
        mustChangePassword: true,
        student: { select: { id: true } },
        trainer: { select: { id: true } },
      },
    })
    .then((user) => {
      if (!user || !user.isActive) throw AppError.unauthorized('Account is not active');
      const route = `${req.method} ${req.originalUrl.split('?')[0]}`;
      if (user.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(route)) {
        throw new AppError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Choose your own password before continuing',
        );
      }
      req.user = {
        id: user.id,
        role: user.role,
        locale: user.locale,
        studentId: user.student?.id ?? null,
        trainerId: user.trainer?.id ?? null,
      };
      next();
    })
    .catch(next);
};

/** Allows only the listed roles (BRQ-1.2). Must run after authenticate. */
export function authorize(...roles: Role[]): RequestHandler & { allowedRoles: Role[] } {
  const handler: RequestHandler = (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    next();
  };
  // Read by the security suite, which checks every route against its roles.
  return Object.assign(handler, { allowedRoles: roles });
}
