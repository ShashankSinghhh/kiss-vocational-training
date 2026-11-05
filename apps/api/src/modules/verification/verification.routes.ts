import { Router } from 'express';
import { AppError } from '../../core/errors';
import { asyncHandler } from '../../core/http';
import { rateLimiter } from '../../core/middleware';
import { settings } from '../../core/settings';
import * as documents from '../documents/documents.service';
import * as passport from '../passport/passport.service';

/** Codes are Crockford base32; anything else can't exist, so it is simply "not found". */
const CODE = /^[0-9A-Za-z]{8,40}$/;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * /api/v1/public — no authentication (CLAUDE.md rule 7, TAD §8.3). A named limiter keeps the
 * count in Postgres in production, so every serverless instance enforces one per-IP limit
 * (setting public.rateLimitPerMin, 30). Responses carry whitelisted fields only (BR-15).
 */
export function publicRoutes(): Router {
  const router = Router();
  router.use(
    rateLimiter({
      name: 'public',
      windowMs: 60_000,
      limit: () => settings.get('public.rateLimitPerMin'),
    }),
  );

  // F15: certificate verification. Revalidated on every view (ETag → cheap 304s) so that a
  // revocation shows at once (BRQ-15.4); see docs/internal/PROGRESS.md, Sprint 9 deviations.
  router.get(
    '/verify/:code',
    asyncHandler(async (req, res) => {
      const code = req.params.code ?? '';
      const result = CODE.test(code) ? await documents.publicVerification(code) : null;
      if (!result) throw new AppError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found');
      void documents.recordVerification(code).catch(() => undefined);
      res.set('Cache-Control', 'no-cache').json(result);
    }),
  );

  // F10: a shared passport, read-only.
  router.get(
    '/passport/:token',
    asyncHandler(async (req, res) => {
      const token = req.params.token ?? '';
      if (!TOKEN.test(token)) throw new AppError(404, 'LINK_NOT_FOUND', 'Link not found');
      res
        .set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
        .json(await passport.publicPassport(token));
    }),
  );
  return router;
}
