# Test plan and report

How the portal is tested, what each level proves, and the latest results. The requirement-by-
requirement view is [TRACEABILITY.md](TRACEABILITY.md): every BRQ and BR with the tests that
prove it, generated from the code.

## Levels

| Level | Tool | Where | What it proves |
| --- | --- | --- | --- |
| **Unit** | Jest | `apps/api/src/**/__tests__/*.test.ts` | Pure business rules with boundary values: attendance % (74.99 / 75.00), grades and bands, eligibility, risk levels (79.99 / 80.00 Medium, 74.99 / 75.00 High), competency gap, match %, allocation order, schedule overlap, chunking and guard order for the assistant, missed-run counting. No database. |
| **Integration** | Jest + Supertest | `apps/api/src/**/__tests__/*.int.test.ts` | Every endpoint against a real PostgreSQL 16: the full request pipeline (auth, roles, ownership, validation), service rules, transactions and audit rows, database constraints and triggers. |
| **Security** | Jest + Supertest | `apps/api/src/__tests__/security.int.test.ts` | Reads the app's own route table (167 routes) so new routes are covered automatically: the access matrix is pinned (who may call each route), every signed-in route refuses a missing token, every role-restricted route refuses every other role *before* validation, student A / trainer A can't reach batch B or student B through any `:id` route, stored script-like text comes back as data. Mutation-checked: removing a role or ownership check makes it fail. |
| **Reliability** | Jest | `apps/api/src/__tests__/reliability.int.test.ts` | A database failure forced in the middle of completion approval and allocation confirm leaves nothing behind (no status, certificate, membership, audit row or notification), and the same action succeeds once the fault is gone (NFR-05). |
| **Browser (e2e)** | Playwright + axe-core | `apps/web/e2e/*.spec.ts` | Real user journeys on desktop and a phone (Pixel 7): enrollment to certificate, attendance and marks, competencies and the Skill Passport, QR verification, at-risk flags, evidence, opportunities, languages, the assistant (mock), XSS as plain text. |
| **Accessibility** | axe-core + Playwright | `apps/web/e2e/a11y.spec.ts` | Every sidebar page of every role and the public pages: no serious or critical WCAG 2.1 A/AA issue. The trainer's attendance workflow done with the keyboard only, desktop and phone. No page scrolls sideways at 360 px. |
| **Performance** | k6, Lighthouse | `perf/`, `.github/workflows/perf.yml` | 100 virtual users on the common pages and APIs, p95 under 2 s; `/verify` under 3 s on a throttled phone; core student pages under 500 KB (also `bundle:check` in CI). |
| **Live acceptance** | Playwright | `gate1-live.yml`, `gate2-live.yml` | The Release 1 and Release 2 gate journeys against the deployed site. |

Test data: integration and browser tests create their own cycles, courses, batches and users
with unique names, so they run in any order against a shared database. The seed is for demos.

## How to run

```bash
pnpm db:up                       # PostgreSQL in Docker
pnpm test                        # API unit + integration (needs db:up)
pnpm test:e2e                    # browser tests (starts API and web)
pnpm lint && pnpm typecheck
pnpm --filter @vtmp/web i18n:check && pnpm --filter @vtmp/web bundle:check
pnpm docs:check                  # traceability is current
```

CI (GitHub Actions, every push and pull request) runs lint, typecheck, the i18n and
traceability checks, unit tests, integration tests against PostgreSQL 16, the production build,
the bundle budget and the full browser suite, then a smoke test of the deployed site.

## Latest results (2026-10-26, Sprint 13)

| Suite | Result |
| --- | --- |
| API unit + integration | **49 suites, 381 tests, all passing** |
| API coverage (statements / branches / functions / lines) | **91.22 % / 73.43 % / 90.93 % / 93.12 %** |
| Browser (desktop + phone) | **65 tests, all passing** (journeys, security, accessibility) |
| Accessibility | every page of every role: **0 serious or critical issues** |
| Traceability | **99 of 99** BRQs and BRs cited by a test or CI check |
| Lighthouse, `/verify` (mobile, slow 4G) | score 100, LCP 0.9 s, 11 KB |
| Lighthouse, sign-in shell | score 94, LCP 2.6 s, 216 KB, 14 requests |
| Live site, first request after idle | 2.66 s (cold start); 0.4–0.6 s warm |

Coverage is measured with `jest --coverage` over the API. Branch coverage is lower because
defensive branches (database errors, provider timeouts, storage failures) are only partly
exercised.

## Known limits

- **Cold start:** the first request after the free hosting has been idle takes about 2.7 s
  (function start plus database wake-up), above the 2 s target; warm requests take under 0.7 s.
  Keeping it warm needs a paid plan or uses up the free database hours.
- **k6 at 100 users** runs in GitHub Actions on a production build (`perf.yml`), not against
  the live site, whose flood limiter and free quota would be used up by one address.
- **Lighthouse on signed-in pages** isn't automated (they need a session); the bundle budget
  covers their size.
- **AI assistant** is tested with mock providers only; it is switched off in production.
- **Translations** pass a completeness check; a native Odia and Hindi review is still pending.
