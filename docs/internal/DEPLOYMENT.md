# Deployment

The demo runs on two free tiers. Neither asks for a card.

| Part                                  | Host                            | Config in repo                                           |
| ------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| Web (React SPA) **and** API (Express) | **Vercel** (Hobby), one project | `vercel.json`, `api/index.js`, `scripts/vercel-build.sh` |
| Database (PostgreSQL 16)              | **Neon** (Free), Singapore      | `prisma/migrations`                                      |

```
browser ──▶ https://kiss-vtmp.vercel.app
              ├─ static files (apps/web/dist, SPA fallback to /index.html)
              └─ /api/* and /health ──▶ serverless function api/index.js (region sin1)
                                          └─ bundled Express app (apps/api/dist/vercel.js)
                                               └──▶ Neon pooled URL (Singapore)
```

The TAD (§4, §11) names Render/Railway for the API as examples. We moved the API onto Vercel
because Render requires a card (PROGRESS.md, Sprint 2). The Express app is unchanged:
locally and in CI it still runs as a normal server (`apps/api/src/server.ts`).

## What serverless changes

| Concern                            | How it is handled                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Refresh cookie (`SameSite=Strict`) | The site and API share one origin, so the cookie is always same-site and no CORS is involved                                                                                                                                                                                                                                                                                                                                                                                   |
| Rate limits                        | Security limiters (failed logins now; the public router in Sprint 9) store counts in the `rate_limits` table (`RATE_LIMIT_STORE=postgres`, the production default), so every function instance shares one limit. The generous global flood limiter stays in memory                                                                                                                                                                                                             |
| Database connections               | Neon's pooled URL with `connection_limit=1` per function instance                                                                                                                                                                                                                                                                                                                                                                                                              |
| Migrations                         | Run in the production build (`scripts/vercel-build.sh`) against the direct URL, before the new code goes live                                                                                                                                                                                                                                                                                                                                                                  |
| Scheduled jobs (Sprint 10)         | Vercel Cron (`crons` in `vercel.json`) calls `GET /api/v1/internal/jobs/risk-evaluation` once a day at 20:30 UTC (02:00 IST; Hobby may fire up to ~1 h late) with `Authorization: Bearer $CRON_SECRET`. A lease row in `job_locks` stops two runs overlapping (session advisory locks don't survive the pooled URL). A run stops after 25 s and reports `partial`; batches go in random order, so later runs reach the rest. node-cron runs the same job at 02:00 only locally |
| Files (Sprint 6+)                  | No persistent disk, so certificate PDFs (and evidence in Sprint 11) go to a **private Vercel Blob store** (`STORAGE_DRIVER=vercel-blob`). The database keeps only the object key; only the API can read the files, using `BLOB_READ_WRITE_TOKEN`. Fonts and PDFKit's data files ship with the function (`includeFiles` in `vercel.json`)                                                                                                                                       |
| Request time                       | Function limit set to 30 s (`vercel.json`). Bulk operations are designed to finish well inside it                                                                                                                                                                                                                                                                                                                                                                              |
| Browser security headers           | The API sets its own (helmet). The pages get theirs from `vercel.json` `headers`: CSP (scripts from the site only; `connect-src` allows `vercel.com` and `*.blob.vercel-storage.com` for evidence uploads), `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, referrer and permissions policies, HSTS. Add any new outside host to the CSP, or the browser blocks it                                                                                                     |

## One-time setup

### 1. Database (Neon)

1. Project `kiss-vtmp`, region **AWS Asia Pacific (Singapore)**, **Postgres 16**. The database
   is `neondb`.
2. **Connect** → copy two strings and remove `&channel_binding=require` from both:
   - **Pooled** (host contains `-pooler`): add `&pgbouncer=true&connection_limit=1`. This is
     `DATABASE_URL`.
   - **Direct** (pooling off). This is `DIRECT_DATABASE_URL`, used only for migrations.
3. Keep both private. If a password is ever pasted somewhere public (or into a chat), reset it
   in Neon (**Roles → neondb_owner → Reset password**) and update Vercel.

### 2. Generate the two secrets (on your machine)

Run this twice and keep each output for the next step. Don't commit or share them.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Vercel project

1. https://vercel.com → sign in with GitHub → **Add New → Project** → import
   `ShashankSinghhh/kiss-vocational-training`.
2. **Project name:** `kiss-vtmp`, which gives the URL `https://kiss-vtmp.vercel.app`. If that
   name is taken, pick another and use its URL everywhere below.
3. **Root Directory:** leave it as the repository root (`./`). Framework preset: **Other**.
   Leave the build and output settings alone, because `vercel.json` sets them.
4. **Environment Variables:** add these for the **Production** environment only:

   | Key                   | Value                                           |
   | --------------------- | ----------------------------------------------- |
   | `NODE_ENV`            | `production`                                    |
   | `DATABASE_URL`        | Neon pooled URL (step 1)                        |
   | `DIRECT_DATABASE_URL` | Neon direct URL (step 1)                        |
   | `JWT_SECRET`          | first generated secret                          |
   | `REFRESH_SECRET`      | second generated secret                         |
   | `PUBLIC_BASE_URL`     | `https://kiss-vtmp.vercel.app`                  |
   | `CORS_ORIGINS`        | `https://kiss-vtmp.vercel.app`                  |
   | `TRUST_PROXY_HOPS`    | `1`                                             |
   | `AI_ENABLED`          | `false`                                         |
   | `STORAGE_DRIVER`      | `vercel-blob` (needs the Blob store in step 3a) |

   Leave Preview without database variables. Preview deployments then show the web app only and
   never touch (or migrate) the production database.

5. **Settings → Functions → Function Region:** make sure it shows **Singapore (sin1)**.
   `vercel.json` requests it, and it keeps the API next to Neon.
6. Click **Deploy**. The build applies migrations, then builds the API bundle and the web app.
7. Check `https://kiss-vtmp.vercel.app/api/v1/health` → `{"status":"ok","db":"ok",…}`.

### 3a. File storage (Vercel Blob, Sprint 6)

Certificate PDFs need a file store; Vercel Blob is included in the Hobby plan, so no card or
new account is needed.

1. In the Vercel project: **Storage → Create Database → Blob**. Name it `kiss-vtmp-files`, and
   if it asks for an access type choose **Private**.
2. **Connect** it to the `kiss-vtmp` project for the **Production** environment. Vercel adds
   `BLOB_READ_WRITE_TOKEN` to the project's environment variables by itself.
3. Make sure `STORAGE_DRIVER=vercel-blob` is set (step 3), then **redeploy** so the function
   picks up both variables.
4. Check: approve one eligible student in **Completion**, then download the certificate. If the
   store is missing, the approval still succeeds but the student stays _Completed_ and the
   queue offers **Retry certificate** once storage works.

Never paste `BLOB_READ_WRITE_TOKEN` anywhere: it can read every stored file.

### 3b. Daily risk check (Vercel Cron, Sprint 10)

1. Generate one more secret with the command in step 2 (any 16+ random characters work).
2. In Vercel, **Settings → Environment Variables**, add `CRON_SECRET` = that value for
   **Production**, then redeploy. Vercel sends it to the cron route as a Bearer token on its own.
3. Check: **Settings → Cron Jobs** lists `/api/v1/internal/jobs/risk-evaluation`. Its log
   shows a 200 after the next run. To run it now without waiting, an admin can press **Run the
   check now** on _At-risk students_.

Without `CRON_SECRET` the route refuses every call (401), so the check only runs when someone
saves attendance, marks or ratings, or presses the button. Never paste the secret anywhere.

The **daily automation** (closing finished batches, waitlist, reminders, notices) is a second
cron, `/api/v1/internal/jobs/daily-automation` at 21:30 UTC (03:00 IST), with the same
`CRON_SECRET`; **Settings → Cron Jobs** lists both. Without the secret, admins can still press
**Run now** on the _Automation_ page. Vercel's free plan runs crons at most once a day, which is
all these jobs need.

### 4. Seed the demo data (once)

Run this from your machine against the **direct** URL, with a strong demo password because the
site is public:

```bash
DATABASE_URL="<neon direct url>" SEED_PASSWORD="<strong demo password>" pnpm db:seed
```

In PowerShell: `$env:DATABASE_URL="…"; $env:SEED_PASSWORD="…"; pnpm db:seed`, then close the
terminal. The seed is idempotent: it never changes passwords or deletes anything. Share the
demo password only with the team and examiners. **Never reuse a real password** (e.g. the
database password) as the demo password.

**Starting over** (wipes everything, including users, applications, certificates and the audit
log, then seeds the clean data). Only do this before real use begins. In one PowerShell window:

```powershell
$env:DATABASE_URL="<neon direct url>"
$env:SEED_PASSWORD="<demo password>"
$env:SEED_ADMIN_PASSWORD="<admin password>"
pnpm --filter @vtmp/api exec prisma migrate reset --force
```

then close the window. Files already uploaded to Vercel Blob (certificate PDFs, evidence) are
not deleted; remove them in the Vercel dashboard (**Storage → Blob**) if you want them gone.

To **change the demo password later**, run the same command with `--reset-passwords`. It sets
`SEED_PASSWORD` on every seeded account (`@kiss-vtmp.test`: admin, trainers, students), clears
lockouts, signs those accounts out everywhere and audit-logs each change. It refuses the default
`Password@123`.

**Give the admin its own password** by also setting `SEED_ADMIN_PASSWORD` (recommended for the
public demo: then the password shared with examiners opens the trainer and student accounts
only). It must differ from `SEED_PASSWORD`, and it isn't the default either.

```bash
DATABASE_URL="<neon direct url>" SEED_PASSWORD="<new demo password>" SEED_ADMIN_PASSWORD="<admin password>" pnpm db:seed --reset-passwords
```

Afterwards, update the GitHub secret `E2E_PASSWORD` to match, and `E2E_ADMIN_PASSWORD` if you
set an admin password (step 6).

**If the admin account gets locked** (anyone who knows its email can lock it for
`auth.lockMinutes` with 5 wrong passwords, and only another admin can press Unlock), unlock it
from your machine without changing any password:

```bash
DATABASE_URL="<neon direct url>" pnpm db:seed --unlock-admins
```

It unlocks every locked admin account (seeded or real) and audit-logs each unlock. Adding a
second admin with a private, non-guessable email (Users page) also lets one admin unlock the
other.

### 5. Freeze `PUBLIC_BASE_URL`

Certificate QR codes (Sprint 6) encode `PUBLIC_BASE_URL/verify/<code>`. **Never change it**
once set (BRD §14, TAD §15.1). If a custom domain is added later, keep the `*.vercel.app` address
working too.

### 6. GitHub (CI smoke test of the live site)

**Settings → Secrets and variables → Actions**:

- Variable `PUBLIC_BASE_URL` = the site URL
- Secret `E2E_PASSWORD` = the demo seed password
- Secret `E2E_ADMIN_PASSWORD` = the admin password, only if you set `SEED_ADMIN_PASSWORD` (the
  manual Gate 1 and Gate 2 workflows sign in as admin; the smoke test signs in as a student)

Every push to `main` then runs the CI job **Smoke test the deployed site** (read-only checks).

## Releasing

Push or merge to `main`. Vercel builds and deploys it automatically, and migrations run first.
Pull requests get Vercel preview URLs for the web app (no API, see step 3.4).

## Troubleshooting

| Symptom                                         | Cause / fix                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Build fails: `DIRECT_DATABASE_URL must be set`  | Add it to the **Production** environment variables                                           |
| Build fails at `migrate deploy`                 | Direct URL is wrong or is the pooled one                                                     |
| `/api/v1/health` returns 503                    | `DATABASE_URL` is wrong, or Neon is waking up (first request after idle). Retry              |
| `401 INVALID_TOKEN` for everyone after a change | `JWT_SECRET` changed. Users just sign in again                                               |
| Everyone gets `429 RATE_LIMITED` on login       | `TRUST_PROXY_HOPS` must be `1` on Vercel, otherwise every visitor looks like one IP          |
| Signed out on every reload                      | Open the site via its Vercel URL. The refresh cookie only works on that origin               |
| Function error: Prisma engine not found         | Redeploy without cache. `vercel.json` `includeFiles` must still match the Prisma client path |

## Security checklist

- [ ] Secrets only in Vercel's environment variables. `.env` is git-ignored.
- [ ] `CRON_SECRET` is set in Vercel (Production) and nowhere else.
- [ ] Neon password reset if it was ever shared outside Neon/Vercel.
- [ ] Demo seed password is not `Password@123`.
- [ ] The demo admin has its own password (`SEED_ADMIN_PASSWORD`), not the shared demo one.
- [ ] Admin password changed after the first sign-in on production.
- [ ] `NODE_ENV=production` (Secure cookie, HSTS, Postgres rate-limit store).
