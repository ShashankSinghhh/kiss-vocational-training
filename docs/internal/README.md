# Team notes

Working notes for the people who build and run KISS SkillBridge. Visitors want the
[main README](../../README.md) and the [project report](../PROJECT_REPORT.md) instead.

| File                                                  | What it is                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [PROGRESS.md](PROGRESS.md)                            | Sprint log: what was built, deviations and known gaps, newest after-release entries first |
| [CHANGELOG.md](CHANGELOG.md)                          | What changed in each release                                                              |
| [DEPLOYMENT.md](DEPLOYMENT.md)                        | How the live site is hosted, seeded, reset and maintained                                 |
| [DEMO.md](DEMO.md)                                    | The demonstration script                                                                  |
| [TRANSLATION_REVIEW.md](TRANSLATION_REVIEW.md)        | Notes for the Odia and Hindi review                                                       |
| [postman/](postman/kiss-vtmp.postman_collection.json) | Postman collection built from the API contract                                            |

## Seed data

| Role    | Accounts (local password `Password@123`; the live site uses a private one) |
| ------- | -------------------------------------------------------------------------- |
| Admin   | `admin@kiss-vtmp.test`                                                     |
| Trainer | `trainer1@kiss-vtmp.test` … `trainer5@kiss-vtmp.test` (one per programme)  |
| Student | `student001@kiss-vtmp.test` … `student100@kiss-vtmp.test`                  |

`pnpm db:seed` is idempotent and creates the clean starting data: one open cycle, five
programmes with 30 courses, one planned batch per course, 5 trainers and 100 students.
`pnpm db:seed --demo-cycle` adds a past "Demo Cycle 2026" with a full term of history for
demonstrations (`--remove-demo-cycle` takes it out). `--reset-passwords` (with
`SEED_PASSWORD`) sets a new password on every seeded account; `pnpm --filter @vtmp/api db:reset`
starts over.

## Scripts

| Command                                            | What it does                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`                                         | Run API and web together with hot reload                                                       |
| `pnpm db:up` / `pnpm db:down`                      | Start / stop the PostgreSQL container                                                          |
| `pnpm db:migrate`                                  | Create and apply Prisma migrations (dev)                                                       |
| `pnpm test` / `pnpm test:unit`                     | API tests (unit and integration; unit only)                                                    |
| `pnpm test:e2e`                                    | Playwright browser tests (run `pnpm --filter @vtmp/web exec playwright install chromium` once) |
| `pnpm lint` / `pnpm typecheck` / `pnpm format`     | Code quality                                                                                   |
| `pnpm build`                                       | Production builds of API and web                                                               |
| `pnpm --filter @vtmp/web i18n:sync` / `i18n:check` | Copy new English keys to Odia and Hindi / fail if any is missing                               |
| `pnpm --filter @vtmp/web bundle:check`             | Fail if a core student page is over 500 KB                                                     |
| `pnpm docs:trace` / `pnpm docs:check`              | Rebuild / verify docs/TRACEABILITY.md                                                          |
| `node scripts/postman.mjs`                         | Rebuild the Postman collection from openapi.yaml                                               |

GitHub Actions also has three workflows started by hand: **Performance** (k6 with 100 users and
Lighthouse) and **Gate 1** / **Gate 2 on the live site** (the release acceptance tests).

## Repository layout

```
apps/api/src/core/      config, errors, http, middleware, db, audit, settings (shared kernel)
apps/api/src/modules/   one folder per module: routes, controller, service, schema, tests
apps/web/src/           components/ui, features/<module>, locales/{en,or,hi}
packages/shared/src/    enums, schemas, types shared by API and web
prisma/                 schema.prisma, migrations, seed.ts
docs/                   public documents; docs/internal/ these team notes
perf/                   k6 load test and Lighthouse budget check
scripts/                Vercel build, traceability and Postman generators
```

## Working together

- `main` is the deployed branch; every push runs the full CI and then deploys.
- Business rules live in services; every status change and its audit row are written in one
  transaction; thresholds are Settings, not numbers in code.
- UI text never goes in components: add keys to `apps/web/src/locales/en/*.json` and use `t()`.
- Never commit `.env` or real secrets. The AI training assistant runs locally on mock providers
  (`AI_ENABLED=true`, `ASSISTANT_PROVIDER=mock`, `AI_MONTHLY_CAP=1`); it is off on the live site.
