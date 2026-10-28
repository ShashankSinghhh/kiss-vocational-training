import type { Request } from 'express';
import type {
  AdminCreateUserInput,
  AdminResetPasswordInput,
  AdminUpdateUserInput,
  BulkStatusInput,
  ChangePasswordInput,
  UpdateProfileInput,
  UserListQuery,
} from '@vtmp/shared';
import { asyncHandler } from '../../core/http';
import { refreshCookie } from '../auth/auth.controller';
import * as usersService from './users.service';

const actor = (req: Request) => ({ userId: req.user!.id, ip: req.ip ?? null });

export const updateMe = asyncHandler(async (req, res) => {
  res.json(await usersService.updateProfile(actor(req), req.body as UpdateProfileInput));
});

export const changeMyPassword = asyncHandler(async (req, res) => {
  await usersService.changePassword(
    actor(req),
    req.body as ChangePasswordInput,
    refreshCookie(req),
  );
  res.status(204).end();
});

export const list = asyncHandler(async (req, res) => {
  res.json(await usersService.listUsers(req.query as unknown as UserListQuery));
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json(await usersService.createUser(actor(req), req.body as AdminCreateUserInput));
});

export const update = asyncHandler(async (req, res) => {
  res.json(
    await usersService.updateUser(actor(req), req.params.id!, req.body as AdminUpdateUserInput),
  );
});

export const setActive = asyncHandler(async (req, res) => {
  res.json(await usersService.setUsersActive(actor(req), req.body as BulkStatusInput));
});

export const remove = asyncHandler(async (req, res) => {
  await usersService.deleteUser(actor(req), req.params.id!);
  res.status(204).end();
});

export const unlock = asyncHandler(async (req, res) => {
  res.json(await usersService.unlockUser(actor(req), req.params.id!));
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { password, mustChangePassword } = req.body as AdminResetPasswordInput;
  res.json(
    await usersService.resetPassword(actor(req), req.params.id!, password, mustChangePassword),
  );
});
