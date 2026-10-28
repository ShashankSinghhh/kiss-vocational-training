import { z } from 'zod';

/** Notification types; each is also the i18n key `notifications:types.<TYPE>`. */
export const NOTIFICATION_TYPES = [
  'ENROLLMENT_APPROVED',
  'ENROLLMENT_REJECTED',
  'ENROLLMENT_WAITLISTED',
  'ENROLLMENT_ALLOCATED',
  'BATCH_ACTIVATED',
  'TRAINING_COMPLETED',
  'TRAINING_NOT_COMPLETED',
  'TRAINING_WITHDRAWN',
  'CERTIFICATE_ISSUED',
  'RISK_FLAG_ESCALATED',
  'RISK_ACTION_AGREED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  /** English fallback; the web app renders `type` + `data` through t() instead. */
  title: string;
  body: string;
  data: Record<string, string> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const NotificationListQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
