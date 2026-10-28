import type { Request } from 'express';
import type {
  BatchCreateInput,
  BatchStatus,
  BatchUpdateInput,
  SessionCreateInput,
  WithdrawFromTrainingInput,
} from '@vtmp/shared';
import { asyncHandler } from '../../core/http';
import * as allocation from './allocation.service';
import * as service from './batches.service';

const actor = (req: Request) => ({ userId: req.user!.id, ip: req.ip ?? null });
const p = (req: Request, name: string) => req.params[name]!;

// ─── Any signed-in user (ownership checked by the route) ───────────────────────

export const mine = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await service.mine(req.user!));
});

export const detail = asyncHandler(async (req, res) => {
  res.json(await service.detail(p(req, 'batchId'), req.user!.role));
});

export const sessions = asyncHandler(async (req, res) => {
  res.json(await service.sessions(p(req, 'batchId')));
});

// ─── Admin ─────────────────────────────────────────────────────────────────────

export const list = asyncHandler(async (req, res) => {
  res.json(
    await service.list(req.query as { cycleId?: string; courseId?: string; status?: BatchStatus }),
  );
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json(await service.create(actor(req), req.body as BatchCreateInput));
});

export const update = asyncHandler(async (req, res) => {
  res.json(await service.update(actor(req), p(req, 'batchId'), req.body as BatchUpdateInput));
});

export const activate = asyncHandler(async (req, res) => {
  res.json(await service.activate(actor(req), p(req, 'batchId')));
});

export const close = asyncHandler(async (req, res) => {
  res.json(await service.close(actor(req), p(req, 'batchId')));
});

export const candidates = asyncHandler(async (req, res) => {
  res.json(await service.candidates(p(req, 'batchId')));
});

export const addStudent = asyncHandler(async (req, res) => {
  const { enrollmentId } = req.body as { enrollmentId: string };
  res.json(await service.addStudent(actor(req), p(req, 'batchId'), enrollmentId));
});

export const removeStudent = asyncHandler(async (req, res) => {
  res.json(await service.removeStudent(actor(req), p(req, 'batchId'), p(req, 'enrollmentId')));
});

export const withdrawStudent = asyncHandler(async (req, res) => {
  const { reason } = req.body as WithdrawFromTrainingInput;
  res.json(
    await service.withdrawStudent(actor(req), p(req, 'batchId'), p(req, 'enrollmentId'), reason),
  );
});

export const moveStudent = asyncHandler(async (req, res) => {
  const { toBatchId } = req.body as { toBatchId: string };
  res.json(
    await service.moveStudent(actor(req), p(req, 'batchId'), p(req, 'enrollmentId'), toBatchId),
  );
});

export const trainers = asyncHandler(async (_req, res) => {
  res.json(await service.trainers());
});

export const assignTrainer = asyncHandler(async (req, res) => {
  const { trainerId } = req.body as { trainerId: string };
  res.json(await service.assignTrainer(actor(req), p(req, 'batchId'), trainerId));
});

export const unassignTrainer = asyncHandler(async (req, res) => {
  res.json(await service.unassignTrainer(actor(req), p(req, 'batchId'), p(req, 'trainerId')));
});

export const createSessions = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(
      await service.createSessions(actor(req), p(req, 'batchId'), req.body as SessionCreateInput),
    );
});

export const cancelSession = asyncHandler(async (req, res) => {
  res.json(await service.cancelSession(actor(req), p(req, 'batchId'), p(req, 'sessionId')));
});

export const previewAllocation = asyncHandler(async (req, res) => {
  const { cycleId } = req.body as { cycleId: string };
  res.json(await allocation.preview({ ...actor(req), userId: req.user!.id }, cycleId));
});

export const confirmAllocation = asyncHandler(async (req, res) => {
  const { previewId } = req.body as { previewId: string };
  res.json(await allocation.confirm({ ...actor(req), userId: req.user!.id }, previewId));
});
