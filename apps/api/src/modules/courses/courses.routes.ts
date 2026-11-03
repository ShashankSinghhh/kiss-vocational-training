import { Router } from 'express';
import { z } from 'zod';
import {
  BulkStatusSchema,
  CatalogueQuerySchema,
  CourseCreateSchema,
  CourseUpdateSchema,
  CycleCreateSchema,
  CycleUpdateSchema,
  ProgrammeSchema,
  ProgrammeUpdateSchema,
  OfferingUpsertSchema,
} from '@vtmp/shared';
import { authenticate, authorize } from '../../core/auth';
import { idempotency, validate } from '../../core/middleware';
import * as controller from './courses.controller';

const IdParams = z.object({ id: z.string().uuid() });
const CycleParams = z.object({ cycleId: z.string().uuid() });
const OfferingParams = z.object({ cycleId: z.string().uuid(), courseId: z.string().uuid() });

/** Catalogue for any signed-in user (BRQ-2.2): /courses and /cycles. */
export function catalogueRoutes(): Router {
  const router = Router();
  // authenticate per route, not router.use(): this router is mounted at the API root, and a
  // router-wide guard would turn every unknown path into 401 instead of 404.
  router.get(
    '/courses',
    authenticate,
    validate({ query: CatalogueQuerySchema }),
    controller.catalogue,
  );
  router.get(
    '/courses/:id',
    authenticate,
    validate({ params: IdParams, query: CatalogueQuerySchema }),
    controller.catalogueCourse,
  );
  router.get('/cycles', authenticate, controller.catalogueCycles);
  router.get('/programmes', authenticate, controller.programmes);
  return router;
}

/** Admin management of courses, cycles and enrollment windows (BRQ-2.1, BRQ-2.3). */
export function adminCourseRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('ADMIN'));
  router.get('/courses', controller.listCourses);
  router.post('/courses', validate({ body: CourseCreateSchema }), controller.createCourse);
  router.post(
    '/courses/bulk-status',
    validate({ body: BulkStatusSchema }),
    idempotency(),
    controller.setCoursesActive,
  );
  router.patch(
    '/courses/:id',
    validate({ params: IdParams, body: CourseUpdateSchema }),
    controller.updateCourse,
  );
  router.delete('/courses/:id', validate({ params: IdParams }), controller.deleteCourse);
  router.get('/cycles', controller.cycles);
  router.post('/cycles', validate({ body: CycleCreateSchema }), controller.createCycle);
  router.get('/programmes', controller.programmes);
  router.post('/programmes', validate({ body: ProgrammeSchema }), controller.createProgramme);
  router.patch(
    '/programmes/:id',
    validate({ params: IdParams, body: ProgrammeUpdateSchema }),
    controller.updateProgramme,
  );
  router.patch(
    '/cycles/:id',
    validate({ params: IdParams, body: CycleUpdateSchema }),
    controller.updateCycle,
  );
  router.get(
    '/cycles/:cycleId/offerings',
    validate({ params: CycleParams }),
    controller.listOfferings,
  );
  router.put(
    '/cycles/:cycleId/offerings/:courseId',
    validate({ params: OfferingParams, body: OfferingUpsertSchema }),
    controller.upsertOffering,
  );
  return router;
}
