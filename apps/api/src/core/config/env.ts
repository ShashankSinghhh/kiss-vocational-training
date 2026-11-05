import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v));

export const EnvSchema = z.object({
  // Tolerates values pasted into hosting dashboards with quotes, spaces or capitals.
  NODE_ENV: z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v
            .trim()
            .replace(/^["']|["']$/g, '')
            .toLowerCase()
        : v,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  PORT: z.coerce.number().int().positive().default(4000),
  // Proxies in front of the API in production (host load balancer + web-host rewrite proxy),
  // so req.ip is the real client for per-IP rate limits. See docs/internal/DEPLOYMENT.md.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  // Where named (security) rate limits keep their counts. Serverless instances share no memory,
  // so production defaults to postgres; local dev and tests default to memory.
  RATE_LIMIT_STORE: z.enum(['memory', 'postgres']).optional(),
  // Per-IP flood protection for the whole API (in memory, per instance). A school lab shares
  // one public IP, so keep it generous; the end-to-end suite raises it further.
  GLOBAL_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(100).default(1000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // TAD §9 fixes cost 12; tests lower it for speed. Never below 10 outside tests.
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  PUBLIC_BASE_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  // Files (certificate PDFs, later evidence) live outside the DB (ADR-10). Local disk in dev;
  // a private Vercel Blob store in production, which has no persistent disk.
  STORAGE_DRIVER: z.enum(['local', 'vercel-blob']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  BLOB_READ_WRITE_TOKEN: optionalString,
  // Vercel Cron sends it as a Bearer token to /api/v1/internal/jobs/* (Sprint 10). Without it,
  // the job endpoints refuse every call; locally node-cron runs the jobs instead.
  CRON_SECRET: optionalString.refine((v) => v === undefined || v.length >= 16, {
    message: 'must be at least 16 characters',
  }),
  // F17 AI Training Assistant (ADR-09): off unless AI_ENABLED. AI_MONTHLY_CAP is in US dollars
  // of model usage per calendar month; 0 means no spending, so the assistant stays closed.
  AI_ENABLED: booleanString,
  ANTHROPIC_API_KEY: optionalString,
  AI_MONTHLY_CAP: z.coerce.number().nonnegative().default(0),
  AI_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  // 'mock' answers by quoting the best excerpt, without a model: local demos and e2e only.
  ASSISTANT_PROVIDER: z.enum(['claude', 'mock']).default('claude'),
  // Embeddings for material search: 'voyage' (1024-dim voyage-3.5) in production, 'mock' (a
  // deterministic word-hashing embedding) for development and tests.
  EMBEDDING_PROVIDER: z.enum(['voyage', 'mock']).default('mock'),
  VOYAGE_API_KEY: optionalString,
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'RATE_LIMIT_STORE'> & {
  RATE_LIMIT_STORE: 'memory' | 'postgres';
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

  if (parsed.success) {
    const env = parsed.data;
    if (env.STORAGE_DRIVER === 'vercel-blob' && !env.BLOB_READ_WRITE_TOKEN) {
      problems.push('BLOB_READ_WRITE_TOKEN: required when STORAGE_DRIVER=vercel-blob');
    }
    if (env.NODE_ENV !== 'test' && env.BCRYPT_ROUNDS < 10) {
      problems.push('BCRYPT_ROUNDS: must be at least 10 outside tests');
    }
    if (env.AI_ENABLED && env.ASSISTANT_PROVIDER === 'claude' && !env.ANTHROPIC_API_KEY) {
      problems.push('ANTHROPIC_API_KEY: required when AI_ENABLED=true');
    }
    if (env.EMBEDDING_PROVIDER === 'voyage' && !env.VOYAGE_API_KEY) {
      problems.push('VOYAGE_API_KEY: required when EMBEDDING_PROVIDER=voyage');
    }
    if (env.NODE_ENV === 'production' && env.AI_ENABLED && env.EMBEDDING_PROVIDER === 'mock') {
      problems.push('EMBEDDING_PROVIDER: use voyage in production when AI_ENABLED=true');
    }
    if (env.NODE_ENV === 'production' && env.ASSISTANT_PROVIDER === 'mock') {
      problems.push('ASSISTANT_PROVIDER: mock is for development and tests only');
    }
    if (problems.length === 0) {
      return {
        ...env,
        RATE_LIMIT_STORE:
          env.RATE_LIMIT_STORE ?? (env.NODE_ENV === 'production' ? 'postgres' : 'memory'),
      };
    }
  }
  // Report variable names and reasons only, never values (they may be secrets).
  throw new Error(
    `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
}

let cached: Env | undefined;

/** Validated configuration, loaded once on first access. */
export function config(): Env {
  cached ??= loadEnv();
  return cached;
}
