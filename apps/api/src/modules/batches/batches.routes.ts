import { Router } from 'express';
import { z } from 'zod';
import {
  AllocationConfirmSchema,
  AllocationPreviewRequestSchema,
  AssignStudentSchema,
  AssignTrainerSchema,
  BatchCreateSchema,
  BatchListQuerySchema,
  BatchUpdateSchema,
  MoveStudentSchema,
  SessionCreateSchema,
  SessionStatusUpdateSchema,
  WithdrawFromTrainingSchema,
} from '@vtmp/shared';
import { authenticate, authorize, owns, requireOwnership } from '../../core/auth';
import { idempotency, validate } from '../../core/middleware';
import * as controller from './batches.controller';

const uuid = z.string().uuid();
const BatchParams = z.object({ batchId: uuid });
const StudentParams = z.object({ batchId: uuid, enrollmentId: uuid });
const TrainerParams = z.object({ batchId: uuid, trainerId: uuid });
const SessionParams = z.object({ batchId: uuid, sessionId: uuid });

/**
 * /batches — read access for anyone involved: admins any batch, trainers their assigned
 * batches (BR-05), students the batch they are in. Unknown id → 404, someone else's → 403.
 */
export function batchRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/mine', controller.mine);
  router.get(
    '/:batchId',
    requireOwnership(owns.batch()),
    validate({ params: BatchParams }),
    controller.detail,
  );
  router.get(
    '/:batchId/sessions',
    requireOwnership(owns.batch()),
    validate({ params: BatchParams }),
    controller.sessions,
  );
  return router;
}

/** /admin/batches, /admin/allocations, /admin/trainers — Admin only (BRQ-4.1–4.4). */
export function adminBatchRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('ADMIN'));

  router.get('/trainers', controller.trainers);

  router.post(
    '/allocations/preview',
    validate({ body: AllocationPreviewRequestSchema }),
    controller.previewAllocation,
  );
  router.post(
    '/allocations/confirm',
    validate({ body: AllocationConfirmSchema }),
    idempotency(),
    controller.confirmAllocation,
  );

  router.get('/batches', validate({ query: BatchListQuerySchema }), controller.list);
  router.post('/batches', validate({ body: BatchCreateSchema }), controller.create);
  router.patch(
    '/batches/:batchId',
    validate({ params: BatchParams, body: BatchUpdateSchema }),
    controller.update,
  );
  router.post(
    '/batches/:batchId/activate',
    validate({ params: BatchParams }),
    idempotency(),
    controller.activate,
  );
  router.post(
    '/batches/:batchId/close',
    validate({ params: BatchParams }),
    idempotency(),
    controller.close,
  );

  router.get(
    '/batches/:batchId/candidates',
    validate({ params: BatchParams }),
    controller.candidates,
  );
  router.post(
    '/batches/:batchId/students',
    validate({ params: BatchParams, body: AssignStudentSchema }),
    controller.addStudent,
  );
  router.delete(
    '/batches/:batchId/students/:enrollmentId',
    validate({ params: StudentParams }),
    controller.removeStudent,
  );
  router.post(
    '/batches/:batchId/students/:enrollmentId/move',
    validate({ params: StudentParams, body: MoveStudentSchema }),
    controller.moveStudent,
  );
  router.post(
    '/batches/:batchId/students/:enrollmentId/withdraw',
    validate({ params: StudentParams, body: WithdrawFromTrainingSchema }),
    idempotency(),
    controller.withdrawStudent,
  );

  router.post(
    '/batches/:batchId/trainers',
    validate({ params: BatchParams, body: AssignTrainerSchema }),
    controller.assignTrainer,
  );
  router.delete(
    '/batches/:batchId/trainers/:trainerId',
    validate({ params: TrainerParams }),
    controller.unassignTrainer,
  );

  router.post(
    '/batches/:batchId/sessions',
    validate({ params: BatchParams, body: SessionCreateSchema }),
    controller.createSessions,
  );
  router.patch(
    '/batches/:batchId/sessions/:sessionId',
    validate({ params: SessionParams, body: SessionStatusUpdateSchema }),
    controller.cancelSession,
  );
  return router;
}
