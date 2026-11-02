import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../../app';
import { loadEnv } from '../config';
import { withConnectionLimit } from '../db';
import { AppError, errorHandler, notFoundHandler } from '../errors';
import { asyncHandler, paginated, parsePagination } from '../http';
import { validate } from '../middleware';

function appWith(register: (app: express.Express) => void) {
  const app = express();
  app.use(express.json());
  register(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('error shape', () => {
  it('unknown routes return 404 ROUTE_NOT_FOUND in the standard body', async () => {
    const res = await request(createApp()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'ROUTE_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('AppError keeps its status and code', async () => {
    const app = appWith((a) =>
      a.get(
        '/x',
        asyncHandler(async () => {
          throw AppError.conflict('DUPLICATE_ENROLLMENT', 'Already enrolled');
        }),
      ),
    );
    const res = await request(app).get('/x');
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'DUPLICATE_ENROLLMENT', message: 'Already enrolled' });
  });

  it('unexpected errors become 500 INTERNAL_ERROR without leaking the message', async () => {
    const app = appWith((a) =>
      a.get(
        '/x',
        asyncHandler(async () => {
          throw new Error('db password is hunter2');
        }),
      ),
    );
    const res = await request(app).get('/x');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('malformed JSON becomes 400 MALFORMED_JSON', async () => {
    const app = appWith((a) => a.post('/x', (_req, res) => res.json({})));
    const res = await request(app).post('/x').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('a body over the limit becomes 413, not a 500 (security review, low)', async () => {
    const app = appWith((a) => a.post('/x', (_req, res) => res.json({})));
    const res = await request(app)
      .post('/x')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('an unsupported body encoding becomes 415', async () => {
    const app = appWith((a) => a.post('/x', (_req, res) => res.json({})));
    const res = await request(app)
      .post('/x')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'x-unknown')
      .send('{}');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('validate()', () => {
  const app = appWith((a) =>
    a.post(
      '/items/:id',
      validate({
        params: z.object({ id: z.string().uuid() }),
        query: z.object({ dryRun: z.coerce.boolean().default(false) }),
        body: z.object({ name: z.string().min(1) }).strict(),
      }),
      (req, res) => res.json({ params: req.params, query: req.query, body: req.body }),
    ),
  );
  const id = '6f1c2a3e-1b2c-4d5e-8f90-123456789abc';

  it('passes parsed values to the handler', async () => {
    const res = await request(app).post(`/items/${id}?dryRun=1`).send({ name: 'Solar' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ params: { id }, query: { dryRun: true }, body: { name: 'Solar' } });
  });

  it('rejects invalid input with 422 and field details', async () => {
    const res = await request(app).post('/items/not-a-uuid').send({ name: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'id' })]),
    );
  });
});

describe('pagination', () => {
  it('defaults to page 1 of 20', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('computes skip/take from query strings', () => {
    expect(parsePagination({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
      skip: 100,
      take: 50,
    });
  });

  it('accepts pageSize 100 and rejects 101', () => {
    expect(parsePagination({ pageSize: '100' }).pageSize).toBe(100);
    expect(() => parsePagination({ pageSize: '101' })).toThrow();
  });

  it('builds page meta', () => {
    const page = parsePagination({ page: '2', pageSize: '10' });
    expect(paginated(['a'], 21, page).meta).toEqual({
      page: 2,
      pageSize: 10,
      total: 21,
      totalPages: 3,
    });
  });
});

describe('config', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    REFRESH_SECRET: 'y'.repeat(32),
    PUBLIC_BASE_URL: 'https://vtmp.example.org',
  };

  it('applies defaults and parses lists', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.PORT).toBe(4000);
    expect(env.AI_ENABLED).toBe(false);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('names bad variables without printing their values', () => {
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short-secret-value' })).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ ...base, JWT_SECRET: 'short-secret-value' })).not.toThrow(
      /short-secret-value/,
    );
  });

  it('normalises NODE_ENV pasted with quotes, spaces or capitals', () => {
    expect(loadEnv({ ...base, NODE_ENV: ' "Production" ' }).NODE_ENV).toBe('production');
    expect(() => loadEnv({ ...base, NODE_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });

  it('requires an API key when AI is enabled', () => {
    expect(() => loadEnv({ ...base, AI_ENABLED: 'true' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('database pool', () => {
  it('adds connection_limit=5 unless one is set', () => {
    expect(withConnectionLimit('postgresql://u:p@h:5432/db?schema=public')).toContain(
      'connection_limit=5',
    );
    expect(withConnectionLimit('postgresql://u:p@h:5432/db?connection_limit=2')).toContain(
      'connection_limit=2',
    );
  });
});

describe('CORS allow-list', () => {
  it('allows configured origins and rejects others', async () => {
    const app = createApp();
    const ok = await request(app).get('/api/v1/nope').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(app).get('/api/v1/nope').set('Origin', 'https://evil.example');
    expect(bad.status).toBe(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('always allows same-origin requests, e.g. a Vercel per-deployment URL', async () => {
    const res = await request(createApp())
      .get('/api/v1/nope')
      .set('Host', 'kiss-vtmp-abc123.vercel.app')
      .set('Origin', 'https://kiss-vtmp-abc123.vercel.app');
    expect(res.status).toBe(404);
  });
});
