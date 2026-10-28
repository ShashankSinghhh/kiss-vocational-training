import { Router } from 'express';
import { z } from 'zod';
import {
  AdminCreateUserSchema,
  AdminResetPasswordSchema,
  AdminUpdateUserSchema,
  BulkStatusSchema,
  ChangePasswordSchema,
  UpdateProfileSchema,
  UserListQuerySchema,
} from '@vtmp/shared';
import { authenticate, authorize } from '../../core/auth';
import { idempotency, validate } from '../../core/middleware';
import * as controller from './users.controller';

const IdParams = z.object({ id: z.string().uuid() });

/** /users/me — any signed-in user manages their own profile. */
export function meRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.patch('/me', validate({ body: UpdateProfileSchema }), controller.updateMe);
  router.post(
    '/me/password',
    validate({ body: ChangePasswordSchema }),
    controller.changeMyPassword,
  );
  return router;
}

/** /admin/users — Admin only. */
export function adminUserRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('ADMIN'));
  router.get('/', validate({ query: UserListQuerySchema }), controller.list);
  router.post('/', validate({ body: AdminCreateUserSchema }), controller.create);
  router.post(
    '/bulk-status',
    validate({ body: BulkStatusSchema }),
    idempotency(),
    controller.setActive,
  );
  router.patch(
    '/:id',
    validate({ params: IdParams, body: AdminUpdateUserSchema }),
    controller.update,
  );
  router.delete('/:id', validate({ params: IdParams }), controller.remove);
  router.post('/:id/unlock', validate({ params: IdParams }), controller.unlock);
  router.post(
    '/:id/password',
    validate({ params: IdParams, body: AdminResetPasswordSchema }),
    controller.resetPassword,
  );
  return router;
}
