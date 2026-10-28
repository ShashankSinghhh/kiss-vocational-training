import { z } from 'zod';
import { LocaleSchema, RoleSchema } from '../enums';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt ignores bytes beyond 72

const email = z.string().trim().toLowerCase().email().max(254);

/**
 * A4: at least 8 characters with a letter and a digit, so "aaaaaaaa" or "12345678" are refused.
 * Login accepts any password (below); this applies when one is set.
 */
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((p) => /\p{L}/u.test(p) && /\d/.test(p), {
    message: 'Use at least one letter and one digit',
  });

export const LoginSchema = z.object({
  email,
  // Login accepts any non-empty password; length rules apply when setting one.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: PasswordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

const phone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s]{7,20}$/, 'Enter a valid phone number');

export const UpdateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    locale: LocaleSchema,
    phone: phone.nullable(),
    /** Students only: name in Odia script for the certificate (BRQ-16.2). */
    nameOdia: z
      .string()
      .trim()
      .max(120)
      .regex(/^[଀-୿\s.'-]+$/, 'Use Odia script')
      .nullable(),
  })
  .partial()
  .strict();
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const MeSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  role: RoleSchema,
  locale: LocaleSchema,
  /** The password was set by an admin: the user must choose their own before anything else. */
  mustChangePassword: z.boolean(),
  student: z
    .object({
      id: z.string().uuid(),
      rollNo: z.string(),
      cgpa: z.string(),
      phone: z.string().nullable(),
      nameOdia: z.string().nullable(),
    })
    .nullable(),
  trainer: z
    .object({
      id: z.string().uuid(),
      employeeCode: z.string(),
      phone: z.string().nullable(),
      specialization: z.string().nullable(),
    })
    .nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export interface AuthSession {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: Me;
}

// ─── Admin user management ────────────────────────────────────────────────────

const base = {
  email,
  fullName: z.string().trim().min(2).max(120),
  password: PasswordSchema,
  locale: LocaleSchema.default('en'),
  /** Ask the user to choose their own password at first sign-in (A3); off unless sent. */
  mustChangePassword: z.boolean().optional(),
};

export const AdminCreateUserSchema = z.discriminatedUnion('role', [
  z.object({
    ...base,
    role: z.literal('STUDENT'),
    rollNo: z.string().trim().min(1).max(40),
    cgpa: z.coerce.number().min(0).max(10),
    phone: phone.optional(),
  }),
  z.object({
    ...base,
    role: z.literal('TRAINER'),
    employeeCode: z.string().trim().min(1).max(40),
    specialization: z.string().trim().max(120).optional(),
    phone: phone.optional(),
  }),
  z.object({ ...base, role: z.literal('ADMIN') }),
]);
export type AdminCreateUserInput = z.infer<typeof AdminCreateUserSchema>;

export const AdminUpdateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    isActive: z.boolean(),
    locale: LocaleSchema,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserSchema>;

/** Admin sets a new password for someone who forgot theirs; it is shared with them privately. */
export const AdminResetPasswordSchema = z
  .object({
    password: PasswordSchema,
    /** Ask the user to choose their own at next sign-in; on unless sent as false. */
    mustChangePassword: z.boolean().optional(),
  })
  .strict();
export type AdminResetPasswordInput = z.infer<typeof AdminResetPasswordSchema>;

export const UserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  role: RoleSchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  fullName: z.string(),
  role: RoleSchema,
  locale: LocaleSchema,
  isActive: z.boolean(),
  lockedUntil: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  rollNo: z.string().nullable(),
  employeeCode: z.string().nullable(),
});
export type UserSummary = z.infer<typeof UserSummarySchema>;
