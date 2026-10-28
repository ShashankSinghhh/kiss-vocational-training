import type { Request } from 'express';
import type {
  BulkStatusInput,
  CourseCreateInput,
  CourseUpdateInput,
  CycleCreateInput,
  CycleUpdateInput,
  OfferingUpsertInput,
} from '@vtmp/shared';
import { AppError } from '../../core/errors';
import { asyncHandler } from '../../core/http';
import { capacityByCourse, liveBatchesByCourse, membersByCourse } from '../batches/batches.service';
import { approvedFirstChoice } from '../enrollments/enrollments.service';
import * as service from './courses.service';

const actor = (req: Request) => ({ userId: req.user!.id, ip: req.ip ?? null });
const cycleIdQuery = (req: Request) => (req.query as { cycleId?: string }).cycleId;

/** Seats taken = students placed in the course's batches + approved first choices not yet placed. */
async function seatsTaken(cycleId: string): Promise<Map<string, number>> {
  const [placed, approved] = await Promise.all([
    membersByCourse(cycleId),
    approvedFirstChoice(cycleId),
  ]);
  const total = new Map(placed);
  for (const [course, n] of approved) total.set(course, (total.get(course) ?? 0) + n);
  return total;
}

export const catalogue = asyncHandler(async (req, res) => {
  res.json(await service.catalogue(cycleIdQuery(req), seatsTaken, capacityByCourse));
});

export const catalogueCourse = asyncHandler(async (req, res) => {
  const { cycle, courses } = await service.catalogue(
    cycleIdQuery(req),
    seatsTaken,
    capacityByCourse,
  );
  const course = courses.find((c) => c.id === req.params.id);
  if (!course) throw AppError.notFound('Course not found in this cycle');
  res.json({ cycle, course });
});

export const cycles = asyncHandler(async (_req, res) => {
  res.json(await service.listCycles());
});

export const catalogueCycles = asyncHandler(async (_req, res) => {
  res.json(await service.catalogueCycles());
});

export const listCourses = asyncHandler(async (_req, res) => {
  res.json(await service.listCourses(liveBatchesByCourse));
});

export const createCourse = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createCourse(actor(req), req.body as CourseCreateInput));
});

export const updateCourse = asyncHandler(async (req, res) => {
  res.json(await service.updateCourse(actor(req), req.params.id!, req.body as CourseUpdateInput));
});

export const setCoursesActive = asyncHandler(async (req, res) => {
  res.json(await service.setCoursesActive(actor(req), req.body as BulkStatusInput));
});

export const deleteCourse = asyncHandler(async (req, res) => {
  await service.deleteCourse(actor(req), req.params.id!);
  res.status(204).end();
});

export const createCycle = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createCycle(actor(req), req.body as CycleCreateInput));
});

export const updateCycle = asyncHandler(async (req, res) => {
  res.json(await service.updateCycle(actor(req), req.params.id!, req.body as CycleUpdateInput));
});

export const listOfferings = asyncHandler(async (req, res) => {
  res.json(await service.listOfferings(req.params.cycleId!));
});

export const upsertOffering = asyncHandler(async (req, res) => {
  res.json(
    await service.upsertOffering(
      actor(req),
      req.params.cycleId!,
      req.params.courseId!,
      req.body as OfferingUpsertInput,
    ),
  );
});
