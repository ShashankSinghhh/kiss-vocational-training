# KISS VTMP — Sprint Progress Log

Read this at the start of every session and update it at the end of every sprint.

## Template

```
## Sprint N — <name> (<status>, <date>)
### Built
### Deviations from BRD/TAD (and why)
### Known gaps / follow-ups
### Definition of done
- [ ] lint · [ ] typecheck · [ ] tests · [ ] openapi.yaml · [ ] seed · [ ] strings externalized
```

---

## Release note (final, 2026-10-26)

### Shipped
- **Release 1 (core):** F1 sign-in and roles, F2 courses and cycles, F3 enrollment, F4 batches
  and allocation, F5 attendance, F6 assessments, F7 completion and certificates (PDF with ID
  and QR), F8 reports, F9 dashboards. Gate 1 passed on the live site.
- **Release 2:** F10 Skill Passport with share links, F11 early intervention (nightly risk
  check, actions, escalation), F12 competency gap analyzer, F15 public QR verification, F19 audit
  log viewer. Gate 2 passed on the live site.
- **Release 3:** F13 career and opportunity matcher, F14 smart scheduling advisor (clash
  blocking, free slots, trainers), F16 Odia and Hindi with on-demand fonts and a bundle budget,
  F18 practical evidence with rubrics, F20 outcome analytics and placements.
- **Quality:** 381 API tests (91 % statements, 93 % lines), browser tests on desktop and phone,
  a security suite over all 156 routes, accessibility on every page, every one of the 99
  requirements and rules traced to a test or CI check.

### Built but switched off
- **F17 AI training assistant.** Complete and tested with mock providers (materials upload and
  approval, retrieval, cited answers, practice questions, limits, usage page). Off on the live
  site because it needs paid API keys (Claude and Voyage) and the project has no budget. It can
  be tried locally for free with the mock provider (README).

### Deferred / known gaps
- Native-speaker review of the Odia and Hindi text (machine-drafted, complete).
- Cold start on the free hosting: about 2.7 s for the first request after idle (target 2 s);
  fixing it needs a paid plan.
- The project's final name (user-facing text only, when chosen).

---

## After Sprint 13 — Automatic enrollment approval (2026-10-27)

- **Why:** with about 2,000 applications a cycle, approving each by hand is pointless work. The
  BRD (BRQ-3.3) wants the admin in control, not reading every form.
- **What:** an *Automatic approval* card on the admin Enrollments page:
  - **Switch** (`enrollment.autoApprove`, off by default).
  - **Minimum CGPA** (`enrollment.autoApproveMinCgpa`, 0 = none).
  - **"Courses with prerequisites need my review"** (`enrollment.autoApproveManualIfPrerequisites`,
    on). Prerequisites are free text, so the system can't check them.
  - All three are Settings rows, audited when changed.
- **How it behaves:**
  - When on, an application that passes every rule (pure `screen()` in
    `enrollments/rules.ts`, unit-tested at the 5.99 / 6.00 boundary) is approved in the
    student's own submit (or edit) transaction. It is audited with `by: AUTO_APPROVAL`, and the
    student is notified.
  - Anything else stays Pending. The admin list shows why (`needsReview`: "CGPA 5.20 is below
    6.00", "Electrician has prerequisites").
  - *Approve eligible pending applications* applies the saved rules to what is already pending
    in a cycle. It is one set-based `UPDATE … RETURNING` with bulk audit rows and notifications,
    so thousands of rows fit in one serverless request. A concurrent manual decision wins.
- **API:** `GET/PUT /admin/enrollments/auto-approval`, `POST /admin/enrollments/auto-approve`
  (Admin only; the access-matrix snapshot was updated for the three new routes). openapi.yaml
  and Postman are updated.
- **Tests:** 5 unit tests and 4 integration tests: approved on submit with audit and
  notification; held with reasons; a run approving 2 of 3 then doing nothing on a re-run;
  rules validated, audited, admin-only.
- **Strings:** English, Hindi and Odia. User guide updated.
- **Off by default.** Switch it on in production from the Enrollments page (no deploy needed).

---

## After Sprint 13 — Students choose the training cycle (2026-10-27)

- **Found by the team:** a new demo cycle (Oct 27, 2026 – Oct 27, 2027) with a course and a
  batch did not appear for students. The Courses page always showed one cycle, picked by the
  server (the newest-starting cycle with offerings), and had no way to change it.
- **Now:** the student Courses page has a **Training cycle** dropdown with nothing selected;
  the student chooses, and the page asks them to until they do. The choice stays in the address
  (`?cycle=`). Only cycles that offer at least one active course and have not ended are listed
  (`GET /cycles`, new `catalogueCycles`); the admin cycle list is unchanged.
- Course details and Apply need a cycle (they send the student back to choose one); editing an
  application uses its own cycle; "Apply again" goes to Courses first.
- Strings in en, hi and or; integration test for which cycles are listed; the enrollment e2e
  test checks nothing is pre-selected; user guide updated.
- The API's own default (no `cycleId` → newest cycle) is kept for other callers; the web app no
  longer relies on it.

---

## After Sprint 13 — Admin clean-up, applied courses, phones and translations (2026-10-27)

### Built
- **Latest applications first:** the admin review queue (`GET /admin/enrollments`) is ordered
  newest first (ties by id), and the page intro says so in all three languages.
- **Applied courses in Courses:** the student catalogue marks each course in the student's active
  application for that cycle with *Applied · choice N* and the application's status, and offers
  *View my application* (or *Change my choices* while it can still be edited) instead of *Apply*.
- **Admin clean-up of courses and users** (BRQ-2.1 for courses):
  - lists show active records only by default, with a status filter and (courses) search;
  - select rows, or all shown, and deactivate or reactivate them in one go:
    `POST /admin/courses/bulk-status` and `POST /admin/users/bulk-status` (one transaction, one
    audit row per changed record, unknown id → 404 and nothing changes, Idempotency-Key, never
    yourself; deactivating users ends their sessions);
  - `DELETE /admin/courses/:id` and `DELETE /admin/users/:id` remove only records with no
    history (created by mistake). Anything referenced is refused with 409 `COURSE_IN_USE` /
    `USER_IN_USE` and can only be deactivated. Seven foreign keys to users are `ON DELETE SET
    NULL` in the database (enrollment decider, session trainer, setting editor, rating
    verifier/reviser, resource and material approver), so the service checks those explicitly
    before deleting; every other reference blocks the delete itself. Audited `COURSE_DELETED` /
    `USER_DELETED` in the same transaction.
- **Phones and per-device settings:** the shared `Table` shows each row as a card below the `sm`
  breakpoint (explicit table roles keep screen readers and tests working). List filters (users
  role/status, courses status, enrollments status, catalogue *open only*) are remembered per
  device in `localStorage` via `usePersistentState` (no personal data; falls back to defaults
  when storage is blocked).
- **Translations:** one term per idea across files (Hindi पाठ्यक्रम instead of कोर्स in the
  assistant and errors, Odia ବ୍ୟବହାରକାରୀ for "user"); clearer Hindi confirmation messages;
  a *Standard terms* glossary in `apps/web/src/locales/REVIEW.md`.
- Tests: +10 API tests (newest-first order, bulk status, safe delete including the SET NULL
  case), +3 Playwright tests (applied badge, course clean-up, deleting a mistaken account);
  the access-matrix snapshot gains the 4 new admin-only routes (163 routes with the automatic-approval ones).

### Deviations from BRD/TAD (and why)
- The review queue was oldest first ("in the order they arrived"); the team asked for the
  latest applications first. Allocation order is unchanged (it never used the queue order).

### Known gaps / follow-ups
- Odia ଅଧିବେଶନ for a training session is flagged for the native-speaker review (ସେସନ୍ may read
  more naturally).
- Hand-built tables (competency matrix, audit log, sessions grid) still scroll sideways on
  phones; they are grids, not lists.

### Definition of done
- [x] lint · [x] typecheck · [x] tests · [x] openapi.yaml · [x] seed (no new data needed) ·
  [x] strings externalized (en, hi, or)

---

## After Sprint 13 — High-severity fixes from the site test run (2026-10-28)

A full test run of every screen and process found four high-severity problems (report:
"KISS VTMP — Site test run and fine-tuning report"). All four are fixed here.

### Built
- **A1 Password reset:** `POST /admin/users/:id/password` (Admin). Sets a new password, clears
  any login lock, revokes every session and audits `USER_PASSWORD_RESET` without the password.
  An admin can't reset their own (409 `CANNOT_RESET_OWN_PASSWORD`; they use their profile).
  Users page: **Reset password** per row. This also lets an admin unlock a locked account.
- **D1 Revoked certificates can be replaced:** reissue now works on a REVOKED certificate not
  replaced yet. The new one is VALID with a new code, the old one stays REVOKED (its code keeps
  showing as revoked) and links to it (`CERTIFICATE_REPLACED` audit). Certificates now carry
  `canReissue`; anything else gets 409 `CERTIFICATE_NOT_REISSUABLE`.
- **S1 No overlapping trainings:** a student APPROVED, ALLOCATED or ACTIVE in one cycle can't
  apply for, or be approved into, another cycle whose dates overlap (inclusive). The pure rule
  `cyclesOverlap` and `COMMITTED_STATUSES` live in `enrollments/rules.ts` with boundary tests.
  Apply and approve answer 409 `OVERLAPPING_TRAINING` naming the other cycle; a bulk approval
  rolls back and lists each roll number; the automatic-approval run leaves them pending.
- **P1 Campus-safe rate limit:** the global limiter counts signed-in requests per user (from a
  verified access token) and anonymous ones per IP, so a lab behind one campus IP is not locked
  out together. A forged or expired token is counted against the IP.
- Tests: +14 API tests (reset, reissue after revoke, overlap rule boundaries and flows, limiter
  keys); e2e: password reset, reissue after revoke. Access-matrix snapshot +1 route (164).

### Deviations from BRD/TAD (and why)
- **New business rule beyond BR-01:** BR-01 allows one application per cycle; it said nothing
  about cycles that overlap. The test run showed a student placed in two trainings 3 weeks
  apart in time, so overlapping commitments are now refused. To be confirmed with the BRD owner.
- BR-19 described reissue for valid certificates only; it now also replaces revoked ones.

### Known gaps / follow-ups
- Enrollments approved into overlapping cycles before this change are not undone: check
  existing data once (the seed's Pilot and 2026-27 cycles overlap by 3 weeks).
- The other 18 medium/low items of the report remain open.

### Definition of done
- [x] lint · [x] typecheck · [x] tests · [x] openapi.yaml · [x] seed (no new data needed) ·
  [x] strings externalized (en, hi, or)

---

## After Sprint 13 — Medium-severity fixes from the site test run (2026-10-28)

The eight medium-severity items of the test-run report, all fixed. One migration
(`20261028100000_password_change_and_prerequisite_review`) adds two columns with defaults.

### Built
- **A3 Choose your own password:** `users.must_change_password`. Set when an admin creates an
  account with `mustChangePassword` (the Users form ticks it by default) or resets a password
  (default on). While set, `authenticate` answers 403 `PASSWORD_CHANGE_REQUIRED` on everything
  except `GET /auth/me`, `POST /users/me/password`, `PATCH /users/me` and
  `GET /notifications/me`; the web app sends the user to *Change password*. Changing it clears
  the flag. `Me` carries `mustChangePassword`.
- **A2 Unlock:** `POST /admin/users/:id/unlock` clears a login lock (audited `USER_UNLOCKED`);
  **Unlock** shows on locked rows.
- **D3 Trainer still needed:** deactivating (single or bulk) the only trainer of a planned or
  active batch is refused with 409 `TRAINER_STILL_NEEDED`, naming the batches
  (`batches.batchesOnlyTaughtBy`).
- **T1 Assessment dates:** an assessment's date must fall within its batch's dates (422
  `HELD_OUTSIDE_BATCH`; pure rule `heldInsideBatch`). The completion check for mandatory
  assessments lists the ones still without marks (`missing`).
- **T3 Trainer clashes:** a session with no named trainer is taught by the batch's trainers;
  a clash is hard when the same trainer certainly teaches both (named, or the batch's only
  trainer), soft when the batch has several. Before, only explicitly named trainers clashed.
- **T2 Students who left:** attendance sheets leave out deactivated students unless the session
  already holds their mark, saves no longer require them, and the risk check skips them.
- **S2 Seats:** once a course has batches in a cycle, the catalogue's seats are the total
  capacity of its open batches (`batches.capacityByCourse`); until then the course's plan.
- **D2 Prerequisites:** `courses.prerequisites_need_review` (default true). Unticked, automatic
  approval ignores that course's prerequisites (e.g. "Class 8 pass" that everyone meets).
- Tests: +13 API tests; e2e: first sign-in password change. Access-matrix snapshot +1 route
  (165). The e2e world gives each test batch a co-trainer, because test batches share the
  seeded trainer at the same times, which T3 now rightly treats as a clash.

### Deviations from BRD/TAD (and why)
- BR-20 / BRQ-14.2 treated only trainers named on both sessions as a hard clash. A batch's only
  trainer is now treated as named, because otherwise the usual case (sessions that name nobody)
  was never checked.

### Known gaps / follow-ups
- The seed keeps every course's prerequisites needing review; untick them for the demo if
  automatic approval should approve applications for "Class 8 pass" courses.
- The low-severity items of the report remain open.

### Definition of done
- [x] lint · [x] typecheck · [x] tests · [x] openapi.yaml · [x] seed (defaults cover new
  columns) · [x] strings externalized (en, hi, or)

---

## After Sprint 13 — Low-severity fixes from the site test run (2026-10-28)

Eight of the ten low-severity items fixed; one was already handled and one conflicts with a
project rule (both below).

### Built
- **A4 Passwords:** a new password needs at least one letter and one digit as well as 8
  characters (shared `PasswordSchema`; Unicode letters count, so Odia/Hindi passwords work).
  Sign-in still accepts any password.
- **A5 One answer for every failed sign-in:** a locked account now gets the same 401
  `INVALID_CREDENTIALS` as an unknown email or a wrong password (the password is not checked
  while locked), and the message mentions the lock. This reverses the Sprint 1 choice of a
  separate 429 `ACCOUNT_LOCKED` "accepted for usability": that answer told anyone the email
  exists, and admins can now unlock accounts.
- **S3** My training shows attendance with two decimals (BR-08), as the dashboard does.
- **S4** The student dashboard's headline stays on the training in progress (then a batch
  place) after the student applies for a later cycle.
- **D4** Deactivating a course that has planned or running batches, placed students or open
  windows asks for confirmation and lists them (`AdminCourse.inUse`).
- **D5** `useBatch` sends no request until a batch is chosen (no more 404 on Completion).
- **D6** Dashboard tiles say "Student accounts" / "Trainer accounts" (they count accounts).
- **D7** Outcome analytics says how many certificates were issued after its figures were built
  (`certificatesSinceRefresh`), next to *Refresh now*.
- Tests: +4 API tests; the lock-out test now checks the locked and unknown answers are identical.

### Not changed (and why)
- **S5** was already handled: the Assistant page says "Your course has no approved materials
  yet. Ask your trainer." The test run only looked at the API.
- **P2** (a higher limit for certificate checks) would break CLAUDE.md rule 7 and NFR-09 (30
  requests per minute per IP on public endpoints). The limit is the setting
  `public.rateLimitPerMin`; raise it deliberately if a placement drive needs more.

### Definition of done
- [x] lint · [x] typecheck · [x] tests · [x] openapi.yaml · [x] seed (no new data) ·
  [x] strings externalized (en, hi, or)

---

## Sprint 13 — Hardening, quality and final submission (built, 2026-10-26)

### Built
- **Security suite** (`apps/api/src/__tests__/security.int.test.ts`). It reads the app's own
  route table (156 routes), so a new route is covered without editing the test:
  - the access matrix (who may call each route) is pinned as a snapshot, so any change shows up
    in review;
  - every signed-in route answers 401 without a token; only 13 deliberate routes are public;
  - every role-restricted route answers 403 to every other role, before validation;
  - student A and trainer A get 403/404 on every `:id` route that takes batch B's or student
    B's ids (student, batch, session, assessment, enrollment, result);
  - stored script-like text comes back as data; an e2e test shows it as plain text to the admin.

  Mutation-checked: dropping a role check or an ownership check makes it fail. Public responses
  now also check values (no email or roll number anywhere), not only key names.
- **Reliability** (`reliability.int.test.ts`): a database fault forced in the middle of
  completion approval and of allocation confirm leaves no partial change, and the same action
  succeeds once the fault is gone. Scheduled jobs record their last success
  (`job_locks.last_success_at`), report `missedRuns`, and the daily risk check starts with the
  batches a cut-short run left over (catch-up).
- **Performance:**
  - k6 load test (`perf/load.js`, 100 users, p95 < 2 s) and Lighthouse budgets in a manual
    workflow (`perf.yml`) on a production build.
  - Measured locally: `/verify` scores 100 (LCP 0.9 s, 11 KB, throttled phone); the sign-in
    shell 94 (LCP 2.6 s).
  - Live cold start 2.66 s, warm 0.4–0.6 s.
  - Every foreign key is indexed (now a test).
  - The audit log (which only grows) gets an `(action, created_at)` index, and its filter
    lists read distinct values through the index: 31 ms → 4 ms on 200,000 rows.
  - Only the translations every screen and the app shell need (`common`, `errors`, `auth`,
    `notifications`) load up front; each page loads its own: 37 → 14 requests on the sign-in
    page. A first version preloaded only two, and the deployed smoke test caught the header
    briefly swapping for a spinner (losing focus) on a slow connection; a regression test now
    slows every page namespace down and checks focus stays put.
- **Accessibility** (`e2e/a11y.spec.ts`): axe on every sidebar page of every role and the
  public pages (0 serious issues); the attendance workflow with the keyboard only, desktop and
  phone; no page scrolls sideways at 360 px.
- **Fixes found on the way:**
  - Students who had finished training stayed in the nightly risk check: a certified student
    could be flagged. Now only students in training are evaluated, and a flag closes (audited,
    reason `TRAINING_ENDED`) when its student finishes.
  - The outcome chart showed "0 %" for courses with no finished students; it now says
    "No data yet".
  - The seed records its analytics refresh, so a fresh database shows "Figures as of …".
  - A Sprint 11 e2e test always booked "tomorrow", so repeated local runs filled the seeded
    trainer's calendar; it now spreads its date.
  - `openapi.yaml` lint errors went from 9 to 0.
- **Polish:** page-shaped loading skeletons (24 full-page spinners replaced; no motion for
  users who prefer reduced motion); the local `vite preview` proxies the API.
- **Docs:**
  - `docs/TRACEABILITY.md` is generated by `scripts/traceability.mjs` from the IDs the code,
    `openapi.yaml`, tests and CI checks cite (ranges and lists included). It shows 99 of 99
    covered and is checked in CI (`pnpm docs:check`).
  - `docs/TEST_PLAN.md` with results and coverage.
  - `docs/USER_GUIDE.md` per role with 27 screenshots, taken by
    `pnpm --filter @vtmp/web docs:screens` on a freshly seeded database.
  - `docs/DEMO.md` (10-minute script).
  - `docs/ER.md` gains the Release 3 tables.
  - A Postman collection generated from `openapi.yaml` (`scripts/postman.mjs`; "Sign in" stores
    the token).
  - README with an architecture diagram.

### Deviations
- **k6 runs in GitHub Actions, not against the live site.** 100 users from one address would
  trip the live flood limiter and use the free quota. The workflow is manual and free on a
  public repository.
- **Cold start is documented, not fixed:** keeping the function and Neon awake costs money or
  free-tier hours (zero-budget decision).
- **Lighthouse covers public pages only**; signed-in pages are covered by the bundle budget.
- **Tests were tagged** with the requirement IDs they prove, where they already proved one but
  didn't say so; three tests were added where none existed: certificate QR (BRQ-15.1),
  simpler explanations (BRQ-17.3), gap resources in assistant answers (BRQ-17.4).

### Definition of done
- [x] lint · typecheck · prettier · `i18n:check --strict` · `docs:check` · build · bundle budget
- [x] API: 49 suites, 381 tests passing; coverage 91.22 % statements, 73.43 % branches,
  90.93 % functions, 93.12 % lines
- [x] e2e: 65 tests passing locally on desktop and phone (including a11y and security specs)
- [x] openapi.yaml valid (0 errors); Postman collection regenerated
- [x] Seed: records the analytics refresh; screenshots come from a fresh seed
- [x] Strings externalized in en, hi and or

---

## Sprint 12 — Multilingual and low-bandwidth (F16), outcome analytics (F20), AI training assistant (F17) (built, 2026-10-26)

### Built
- **A) Multilingual and low-bandwidth** (F16):
  - Every Hindi and Odia string is filled in, for all namespaces. `i18n:check` now runs
    `--strict`, so CI fails on a missing or empty string or a placeholder mismatch.
    `apps/web/src/locales/REVIEW.md` lists what a native speaker should review.
  - Noto Sans Oriya and Noto Sans Devanagari (self-hosted, script-only subsets, weights
    400/600/700) load only when Odia or Hindi is chosen.
  - Optional Odia name on the student profile (`students.name_odia`, Odia script only; 422
    `STUDENTS_ONLY` for other roles). Certificates print it under the English name in Noto Sans
    Oriya.
  - Bundle budget: `scripts/check-bundle.mjs` reads the Vite manifest and fails CI if a core
    student page needs more than 500 KB gzip (today 210–227 KB).
  - e2e `i18n.spec.ts`: Odia sign-in screen in the Odia font; a Hindi choice follows the
    student to a second device.
- **B) Outcome analytics** (`modules/analytics`, F20):
  - Migration `20261026051607_f20_outcome_analytics`: `placement_outcomes` and two materialized
    views, `analytics_batch_outcomes` and `analytics_course_competency`, refreshed CONCURRENTLY.
    Rates (completion, certification, attendance, average score, verified competencies,
    placement) are computed on read by pure functions in `analytics/rules.ts`.
  - `GET /analytics/outcomes` (+ `.csv`) by course and batch, filtered by cycle;
    `POST /analytics/refresh`; placements: list, candidates by roll number, record (422
    `NOT_FINISHED`, `OPPORTUNITY_NOT_FOUND`), delete. All Admin, all changes audited.
  - Nightly refresh: Vercel Cron `/api/v1/internal/jobs/analytics-refresh` at 21:00 UTC (02:30
    IST) under a job lease; node-cron locally. Cron routes moved to `src/jobRoutes.ts`.
  - UI: admin **Outcome analytics** with headline figures, a lazy-loaded bar chart, course and
    batch tables, CSV export and placement recording.
- **C) AI training assistant** (`modules/assistant`, F17), off unless `AI_ENABLED`:
  - Migration `20261026052801_f17_ai_assistant`: pgvector, `materials`, `material_chunks`
    (`vector(1024)`, HNSW cosine index) and `assistant_logs`. New settings:
    `assistant.dailyLimitPerUser` (30), `assistant.minSimilarity` (0.4), `assistant.topK` (5),
    `assistant.chunkTokens` (500), `assistant.chunkOverlapTokens` (50) and
    `assistant.materialMaxBytes` (10 MB).
  - Materials (Admin): upload a PDF, .txt or .md straight to the store, then approve or reject.
    Approval extracts the text (unpdf for PDFs), splits it into ~500-token excerpts with
    overlap, embeds them and makes them searchable. A scan with no text layer is refused (422
    `NO_TEXT`). Every step is audited.
  - `POST /assistant/ask` (Student), in order:
    - the switch (503 `AI_DISABLED`), the daily limit (429 `ASSISTANT_DAILY_LIMIT`) and the
      monthly cap (503 `ASSISTANT_BUDGET_REACHED`);
    - only approved materials of the student's own courses (from their placements, never from
      the request);
    - top 5 excerpts by cosine similarity; below 0.4 it declines (`NOT_IN_MATERIALS`) **without
      calling the model**;
    - otherwise Claude (`claude-haiku-5-5`) with structured output. The model gets only the
      excerpts, the question and the reply language (the student's locale), never the
      student's name, roll number or contact details (NFR-13). Off-topic replies come back as
      `OFF_TOPIC`.
    - Practice mode returns MCQs; the server keeps only those with 4 options, a valid answer
      and a source it sent.
    - Each reply lists its numbered sources and approved resources for the student's open skill
      gaps (from F12).
    - Every request past the guard is logged: question, excerpt ids, best similarity, tokens,
      cost, latency, refusal reason.
  - `GET /assistant/status` (Student) and `GET /assistant/usage` (Admin: questions, answers,
    refusals by reason, tokens, cost against the cap, average latency).
  - Providers sit behind interfaces: embeddings are Voyage `voyage-3.5` (1024 dims) in
    production and a word-hashing mock locally; answers are Claude, or a mock that quotes the
    best excerpt (`ASSISTANT_PROVIDER=mock`, refused in production) for local demos and e2e.
  - UI: student **Training assistant** (three modes, cited answers with expandable source
    excerpts, practice questions with Check answer, resources, questions left today, a
    disclaimer) and admin **Assistant materials** (usage card, upload, review table).
  - The browser upload helper is shared by evidence and materials (`lib/upload.ts`).

### Deviations
- **Translations are machine-drafted.** They pass the strict completeness check, but a native
  Odia and Hindi speaker should review them (`locales/REVIEW.md`) before the pilot.
- **Embeddings come from Voyage AI** (Anthropic has no embedding model). Production needs
  `EMBEDDING_PROVIDER=voyage` and `VOYAGE_API_KEY`; the config refuses to start with mock
  embeddings when the assistant is on in production.
- **`AI_MONTHLY_CAP` is in US dollars** of model usage per calendar month (IST); 0 keeps the
  assistant closed even when switched on. Embedding cost is not counted (it is tiny).
- **Refusals count toward the daily limit**, so the limit also caps retrieval cost.
- **Deleting a material removes it from search** (rows and excerpts, audited) but leaves the
  file in the store; the storage adapter has no delete yet.
- **Jest cannot load PDF.js** (an ES module bundle). Integration tests swap in a stub for PDF
  text; the e2e test uploads a real PDF and covers unpdf.
- **unpdf is pinned to 1.4.0.** Later releases bundle a PDF.js that needs Node 22; the stack
  (CI and Vercel) runs Node 20.
- **Lighthouse was not run.** The bundle budget check stands in for the low-bandwidth target.
- Fixed a flaky Sprint 11 test: it tampered with the last base64url character of a signed link,
  which can carry only padding bits and decode to the same signature.

### Known gaps / follow-ups
- Going live with the assistant needs, in Vercel: `AI_ENABLED=true`, `ANTHROPIC_API_KEY`,
  `AI_MONTHLY_CAP`, `EMBEDDING_PROVIDER=voyage`, `VOYAGE_API_KEY`. Then upload and approve at
  least one material per pilot course.
- The seed adds no materials or placements.
- `openapi.yaml` still has 9 older lint errors (unquoted commas in descriptions); the new paths
  add none.

### Definition of done
- [x] Unit: analytics rates (zero denominators, late as present); chunking (sizes, overlap,
  empty text); guard order (off, daily limit, cap of 0); similarity threshold; cost.
- [x] Integration: analytics views and placements; materials (PDF approve with 1024-dim
  vectors, empty file, wrong-course key, admin only); ask (switch off, cap, daily limit, no
  model call below the threshold, own course only, no personal data sent, practice
  validation, off-topic, usage). Full API suite: 46 suites, 360 tests.
- [x] e2e: `i18n.spec.ts` and `assistant.spec.ts` (admin uploads and approves a real PDF; the
  student gets a cited answer, checks a practice question and is declined off-topic; axe
  clean on both pages).
- [x] lint · typecheck · prettier · `i18n:check --strict` · build · bundle budget
- [x] openapi.yaml: analytics, placements, assistant, materials and the analytics cron
- [x] Strings externalized in en, hi and or

---

## Sprint 11 — Smart scheduling (F14), practical evidence (F18), career matcher (F13) (built, 2026-10-26)

### Built
- **R3 tables**: migration `20261026033923_r3_evidence_opportunities` adds `rubrics`,
  `practical_evidence`, `job_roles`, `job_role_competencies`, `opportunities` and
  `opportunity_interests`. DB checks: role levels 1–4; evidence is either a stored file
  (≤ 10 MB) or a link, never both. New settings: `scheduling.capacityWarnPercent` (90),
  `evidence.maxBytes` (10 MB), `evidence.allowedMime` (JPEG, PNG, WebP, PDF),
  `evidence.uploadTtlSeconds` (600) and `evidence.downloadTtlSeconds` (300).
- **A) Scheduling advisor** (`modules/scheduling-advisor`, F14):
  - BR-20 rules in `batches/rules.ts`: `overlaps` (startA < endB && startB < endA, so back to
    back is fine), `sameVenue` (case and space insensitive), `clashesFor` and `capacityLevel`.
    All are unit-tested.
  - Session creation (core) now refuses hard clashes with 409 `SCHEDULE_CLASH`, listing each
    clash. It takes a transaction advisory lock, so two admins can't book the same slot at once.
  - `POST /scheduling/check` (Admin, read-only) reports, per batch:
    - capacity after adding students (NEAR ≥ 90 %, OVER > 100 %);
    - venue and trainer clashes of proposed and upcoming sessions;
    - free nearby slots of the same length, within the 08:00–19:00 working day, for each
      clashing proposed session;
    - free trainers, specialisation matches first.
  - UI: a "Scheduling check" panel in the allocation preview, and an inline clash message in
    the schedule-sessions dialog with clickable free times.
- **B) Practical evidence** (`modules/evidence`, F18):
  - `PUT/GET /assessments/:id/rubric` (named criteria and ascending levels, practical
    assessments only).
  - `POST /evidence/upload-url` checks type and size against Settings (422 `UNSUPPORTED_TYPE` /
    `FILE_TOO_LARGE`). It returns a one-file target under a server-chosen key:
    - production: a Vercel Blob **client token** scoped to that key, type and size;
    - development and tests: an HMAC-signed local URL.

    The browser uploads directly, never through the API function.
  - `POST /results/:id/evidence` records the file or https video link, the course competency it
    proves (BRQ-18.3) and rubric scores. Checks:
    - the file must exist in the store under the result's prefix, with an allowed type and size;
    - a file attaches once.

    Audited.
  - `GET /evidence/:id/url` returns a 5-minute signed link (`presignUrl` on Blob). It is for the
    batch's trainers, admins and the student the evidence belongs to.
  - `GET /assessments/:id/evidence` returns the trainer's sheet.
  - Core `files` route `/api/v1/files/:token` stands in for Blob locally (404 in production).
    Storage adapter: `stat`, `uploadTarget` and `signedUrl` for both drivers.
  - The signed-in Skill Passport lists evidence under each verified practical competency
    (BRQ-10.2). Public share links don't.
  - UI:
    - an "Evidence" link on practical assessments;
    - a rubric editor with a sensible default;
    - per-student evidence with Open;
    - an add dialog with a drop zone, client-side photo compression (≤ 1600 px, JPEG 0.8 above
      400 KB), competency and rubric scores.

    The Blob client is lazy-loaded (its own 27 kB chunk).
- **C) Career matcher** (`modules/opportunities`, F13):
  - Admin CRUD for job roles (competency codes and levels, BRQ-C.3) and opportunities
    (internship, apprenticeship or job; partner; closes on).
  - `GET /students/me/matches` ranks open opportunities by match % = verified required ÷ total
    required × 100 (BR-22; pure `matchPercent`, `evaluateRole`, `rankMatches`, unit-tested).
    Missing skills come with the level reached so far and approved resources from the gap
    analyzer (BRQ-13.3).
  - Interest: `POST/DELETE /opportunities/:id/interest` (idempotent; 409 once closed).
  - Admin sees interested students with their match % and a CSV export (BRQ-13.4).
  - UI:
    - student **Opportunities**: match rings with the number in text, missing skills with
      resources, and an "I'm interested" toggle;
    - admin **Opportunities**: tabs for opportunities (status filter, edit, interested list
      with CSV) and job roles.
- **Seed**: three job roles built from the seeded competency codes and four demo opportunities
  (idempotent, audited).

### Deviations
- **Trainer double-booking blocks only when the trainer is named on both sessions.** A session
  with no named trainer is taught by the batch's assigned trainers. Blocking every overlap
  through assignment would reject real schedules, such as the seeded trainer, who teaches the
  live pilot batch and every demo batch. Those overlaps are shown as warnings by the advisor
  instead. Venue clashes always block.
- **Upload "pre-signed URL" in production is a Vercel Blob client token** (the store chosen in
  Sprint 6), scoped to one key, type, size and 10 minutes. Downloads use Blob's signed GET URLs.
  The local driver issues HMAC-signed URLs with the same rules, so tests exercise the flow
  without Vercel.
- **Evidence is not deleted** once attached; it backs marks (BR-12). A wrong upload stays with
  its audit row, and the trainer adds a correct one.
- **Public shared passports don't show evidence.** Photos of students stay behind sign-in (BR-15
  spirit). The signed-in passport and the PDF owner see them.
- **The advisor's free trainers are suggestions only.** Assigning a trainer stays on the batch
  screen.
- **Tests**: fixtures and e2e now use a unique venue per run, so the new clash check never
  collides across runs of the shared test databases.

### Known gaps / follow-ups
- Production uploads use Vercel Blob client tokens and signed GET URLs. Tests cover the local
  driver. **Checked live on 2026-10-26**: a photo uploaded on the deployed site and opened in a
  new tab through its signed link.
- The seed adds no rubric or evidence: they need a trainer's real photos.

### Definition of done
- [x] Unit:
  - overlap boundaries (end == start is not a clash; containment and identical times clash);
  - venue normalisation;
  - hard vs soft trainer clashes;
  - capacity 85/90/100/105 %;
  - match % (1/3 = 33.33, 2/3 = 66.67, 0 required = 0);
  - role evaluation (below level is missing, above counts, case-insensitive codes);
  - ranking.
- [x] API:
  - **Scheduling**:
    - venue clash → 409; back to back is allowed;
    - named trainer clash → 409 with nothing saved;
    - a cancelled session frees the slot;
    - the advisor reports capacity NEAR/OVER, the clash with free 2-hour slots that don't
      overlap, free trainers, and a soft warning that doesn't block;
    - admin only;
    - inverted times → 422.
  - **Evidence**:
    - rubric save, and THEORY → 422;
    - wrong MIME and oversized (10 MB + 1) refused before upload; 10 MB exactly allowed;
    - the upload link enforces its type and size, works once, and refuses expired or
      tampered tokens;
    - only staff of the batch or an admin get links;
    - attach checks a missing upload, another result's key, a duplicate, http links, another
      course's competency and invalid scores;
    - attaching is audited;
    - signed links expire within 5 minutes and are refused after expiry; a put grant can't read;
    - the classmate is refused;
    - the passport shows the evidence.
  - **Opportunities**:
    - roles with upper-case codes and titles; duplicate title → 409;
    - open/closed status;
    - ranking (100 % before 33.33 %) with missing skills and levels; closed opportunities hidden;
    - interest is idempotent; the admin list shows match % and the CSV; withdrawing works;
    - closed → 409;
    - students can't manage roles or opportunities.
  - DB constraints for R3 (level range, file-or-link).
- [x] e2e (desktop + mobile, axe):
  - a clashing session is refused, a suggested free time is chosen and saved;
  - the trainer creates a rubric and uploads a photo with scores;
  - the student sees the evidence in the passport and a 100 % match, and marks interest;
  - the admin sees the interested student.
- [x] API_TESTS (336, 42 suites) · E2E_TESTS (39) · lint · format · typecheck · build · i18n
  keys in sync · openapi.yaml (116 paths)

---

## Sprint 10 — Early Intervention (F11) and audit viewer (F19) → GATE 2 (done, Gate 2 passed 2026-10-26)

### Built
- **Risk rules** (`modules/intervention/rules.ts`, pure, unit-tested at the BRD boundaries):
  - `riskLevel(facts, thresholds)` returns a level and every reason (BR-16, BR-18).
    - Medium: attendance < 80 %, ≥ 3 consecutive absences, or the latest assessment < 50 %.
    - High: attendance < 75 %, projected aggregate < 40 %, a drop of ≥ 15 points from the
      previous assessment to the latest, or an assessed mandatory competency below its
      required level.
    - "Below" is strict: 74.99 % is High, 75.00 % Medium, 79.99 % Medium, 80.00 % Low. A
      15.00-point drop is High, 14.99 is not.
    - Every threshold is a `risk.*` setting.
  - `flagStep` (BR-17 lifecycle) and `shouldEscalate`.
- **Evaluation** (`intervention.service`):
  - `evaluateBatch` gathers each source's facts for the whole batch with one set-based call
    per source: attendance, assessments and competency each gained a batch-level read
    (`batchScores`, `mandatoryGapsByStudent`).
  - It then opens, updates, starts the clear period, closes after `risk.closeAfterClearDays`
    (7) clear days, and escalates High flags open `risk.escalateAfterDays` (14) to every
    admin with an in-app notification.
  - Every step is an audited change (system actor), and the flag's timeline is built from
    those rows, so the history is kept after a flag closes (BRQ-11.4).
  - Writes take `pg_advisory_xact_lock` on the batch, so a scheduled run and an on-save run
    never interleave.
- **Triggers**:
  - **On save**: attendance, marks and competency ratings announce "batch data changed"
    through a new core hook (`core/events`). The intervention module subscribes when routes
    are wired, so core never imports it (rule 5). The re-evaluation is awaited before the
    response, never fire-and-forget. A flag therefore appears as soon as the session is
    marked, well within the BRD's one day.
  - **Daily**: Vercel Cron (`vercel.json`, 20:30 UTC = 02:00 IST) calls
    `GET /api/v1/internal/jobs/risk-evaluation` with `Bearer CRON_SECRET`, checked in
    constant time. node-cron runs the same job at 02:00 locally.
  - **Admin**: `POST /risk-flags/evaluate` runs it now, and the At-risk page has a "Run the
    check now" button.
  - Overlap: a lease row in the new `job_locks` table (migration `20261024120000_job_locks`)
    ensures two runs never overlap.
  - Time budget: a run stops after 25 s and reports `partial` and the number of batches left.
- **API**:
  - `GET /risk-flags` (trainer: own batches, 403 for others; admin: all) with filters for
    batch, level, status (OPEN/CLOSED/ALL) and escalated; paginated, worst first.
  - `GET /risk-flags/:id` returns the flag with its actions, timeline and who can own an
    action.
  - `POST /risk-flags/:id/actions` creates a COUNSELLING, EXTRA_SESSION or PRACTICE_TASK
    action:
    - The owner must be one of the batch's trainers or an admin (422 `INVALID_OWNER`).
    - The due date must be today or later (422 `DUE_IN_PAST`).
    - The flag must be open (409 `FLAG_CLOSED`).
    - The student is notified of the plan, never the staff note.
  - `PATCH /risk-actions/:id {outcome, completedAt?}` records an action's outcome.
  - `GET /students/me/risk` returns the student's own flags.
- **Audit viewer** (`modules/audit`, Admin, read-only):
  - `GET /audit-logs` filters by user, entity, record ID, action and date (inclusive UTC
    days), newest first, paginated.
  - `/audit-logs/facets` supplies the filter lists.
  - `/audit-logs/export.csv` returns the same filters, capped at 10 000 rows, with an
    `X-Export-Truncated` header and CSV-injection-safe cells.
  - There are no edit or delete endpoints (404), and the DB trigger still refuses UPDATE
    (TC-19 asserted again).
- **Web**:
  - **At-risk students** (trainer and admin) shows level badges, reason chips with figures,
    days open, action counts and filters.
  - **Flag detail** shows why the student is flagged, a remedial-actions table with "Add
    action" (type, owner, due date, staff-only note) and "Record outcome", and a history
    timeline of level changes and actions.
  - **Admin dashboard** has an escalations widget.
  - **Student dashboard** shows a "Let's get you back on track" card: the reasons in plain,
    encouraging words (no "risk" wording, no level badge), the agreed plan, and an offer of
    help.
  - **Audit log** has filters, click-a-name to filter by user, a per-row old → new table
    with changed fields marked in text, and CSV export.
  - New strings are in `intervention.json` and `audit.json` (or/hi synced).
- **Fix found while testing**: the Gate 1 integration test runs the whole R1 workflow in one
  test. With the on-save evaluation it sometimes passed Jest's default 5 s under parallel
  load, so it now has an explicit 30 s timeout.

### Deviations
- **Lease row instead of a session advisory lock for the whole run.** Production uses Neon's
  pooled URL (PgBouncer transaction mode, `connection_limit=1`). A session advisory lock is
  released as soon as the connection returns to the pool, and holding one transaction open
  for the whole run would starve the single pooled connection. The run claims a `job_locks`
  row with one atomic upsert (expires after 10 min if a run crashes). Per-batch writes do use
  a transaction-scoped advisory lock, which works with pooling.
- **Facts come from the core services, not one cross-module SQL query.** One set-based call
  per source per batch (not per student), so rule 5 (modules never read another module's
  tables) still holds.
- **Assessment rules use the latest result.** BRD: "an assessment below 50 %" and "a drop
  between consecutive assessments". Using every past result would keep a recovering student
  flagged forever, so a flag could never close (BR-17). The prompt's facts list ("latest and
  previous assessment %") supports this reading.
- **Not-yet-assessed mandatory competencies don't raise a flag.** Early in a course nobody
  has been assessed; BR-18's gap counts once a competency has a rating or linked marks.
- **Vercel Cron calls with GET.** The route accepts GET (what Vercel sends) and POST (manual
  runs), both with the secret.
- **The seed adds no flags.** They are derived data (rule 9). The pilot batch already has
  students below 75 % attendance, and the first evaluation (cron, a save, or the admin button)
  flags them.

### Known gaps / follow-ups
- The admin can revoke a competency verification through the API (Sprint 9); there is no
  screen for it yet. The audit viewer shows those revocations.
- The daily run evaluates batches one at a time. On a much larger live database it could need
  more than one run to cover everything (it reports `partial`). That isn't expected at demo
  scale.

### GATE 2 checklist (BRD §15)
Locally (CI-equivalent), all pass:
- [x] **F10** (BRD §9.2): a certified student opens their passport and sees each verified
      competency with level and date; a shared link opens without login; after revocation it
      shows "Link no longer active". Covered by `passport.spec.ts` on desktop and mobile
      (Pixel 7) and `verification.int.test.ts`.
- [x] **F11** (§9.3): 74.99 % → High (unit). Marking a session flags the student at once
      (integration and e2e). Recording an action, then returning above the thresholds, closes
      the flag after 7 clear days and keeps its history (integration). Escalation at 14 days
      (integration). Student sees the supportive card with the agreed action (e2e).
- [x] **F12** (§9.4): Sprint 8 acceptance tests still green (`competency.int.test.ts`,
      `competency.spec.ts`); a mandatory gap now also raises an F11 flag (integration).
- [x] **F15** (§9.6): the QR target shows Valid with the name; an unknown ID shows Not found;
      a revoked certificate shows Revoked without the reason. The employer view runs on a
      phone viewport in the mobile project (`passport.spec.ts`).
- [x] **On the deployed build** (2026-10-26, workflow `gate2-live.yml`, run 40264378707, all
      green): `passport.spec.ts` on a phone (F10, F15), `competency.spec.ts` (F12) and
      `intervention.spec.ts` (F11, F19) on desktop, against `PUBLIC_BASE_URL`. `CRON_SECRET` is
      set in Vercel (Production) and redeployed; the cron route refuses calls without it (401).
      **Gate 2 passed: R3 (Sprint 11) may start.**

### Definition of done
- [x] Unit: risk boundaries (74.99/75.00, 79.99/80.00, 49.99/50, 39.99/40, 15.00/14.99 drop,
      3 absences), lifecycle (open/update/clearing/close at 7 days, not 6.99), escalation at
      14 days, once
- [x] API (TC-27–31): on-save flagging and level updates; consecutive absences; 15-point
      drop; mandatory gap; inactive batch ignored; close after 7 clear days with history;
      clear period reset when risk returns; escalation to admins once; trainer/admin/student
      scoping (403); action validation (DUE_IN_PAST, INVALID_OWNER, FLAG_CLOSED); student view
      without the staff note; lease prevents a second run; cron route needs the secret; time
      budget reports partial; audit viewer filters, CSV, admin-only, no edit or delete, UPDATE
      refused (TC-19)
- [x] e2e (desktop and mobile, axe on every new page): absence → flag → trainer adds action →
      student sees a supportive card without the note → admin finds it in the audit log
- [x] API_TESTS (307, 37 suites) · E2E_TESTS (37) · lint · format · typecheck · build · i18n
      keys in sync · openapi.yaml (101 paths)

---

## Sprint 9 — Skill Passport (F10) and QR verification (F15) (done, 2026-10-24)

### Built
- **Public router** (`modules/verification`, `/api/v1/public`, CLAUDE.md rule 7):
  - No authentication. A named rate limiter (Postgres-backed in production, so every
    serverless instance shares it) applies the existing setting `public.rateLimitPerMin` (30)
    per IP; the 31st request gets 429.
  - `GET /public/verify/:code` returns exactly name, course, grade, issue date, status and
    `revokedOn`. A revoked certificate shows its date but never its reason. Unknown or
    malformed codes give 404 "Certificate not found" (TC-18). Each lookup of a known code
    bumps `verificationCount` in the background.
  - `GET /public/passport/:token` returns only name, optional photo, verified competencies
    (title, level, course, date) and valid certificates. A revoked or expired link gives 410
    "Link no longer active"; an unknown one gives 404.
  - Tests pin the exact response keys so marks, attendance and contact details can't leak
    (BR-15).
- **Certificates** (documents, core; Admin):
  - `POST /certificates/:id/revoke {reason}` marks it REVOKED at once, keeps it on record and
    audits it (BRQ-15.4).
  - `POST /certificates/:id/reissue` creates a new random code with the same snapshots. The
    old certificate becomes SUPERSEDED with `supersededById` set, the enrollment stays
    CERTIFIED, and the new PDF is rendered (BR-19).
- **Skill Passport** (`modules/passport`, innovation; reads competency, documents and users
  through their services):
  - `GET /students/:id/passport` (`me`; the student, their trainers, admins) lists every
    verified competency across all cycles (BRQ-10.4) with level, date and verifying trainer,
    practical apart from theory (BRQ-10.2), plus certificates. Revoked verifications are
    listed separately with their reason.
  - `GET /students/:id/passport.pdf`.
  - Admin `POST /competency-ratings/:id/revoke {reason}` (BR-14): the rating is kept, leaves
    the passport, and is audited. A trainer may verify it again later, which clears the
    revocation.
  - **Share links** (BRQ-10.3, TAD §9):
    - `POST /students/me/passport/shares {expiresInDays?}` creates 32 random bytes (base64url).
      The token is returned once with its link `/p/<token>`, and only its SHA-256 is stored.
    - Lifetime comes from the new settings `passport.shareDefaultDays` (30) and
      `passport.shareMaxDays` (365).
    - The student can list their links (status and view counts) and revoke one with
      `DELETE /passport/shares/:id`, own links only.
- **Verify page** (NFR-09):
  - A second Vite entry, `verify.html`, with about 150 lines of plain TypeScript and
    hand-written CSS: no React and no app bundle, 4.7 kB gzip in total.
  - It reads `/verify/<code>` (the certificate QR target) and shows a large Valid / Revoked
    (with date) / Superseded / Not found result, with an "enter the ID" form that accepts
    spaces, dashes and lower case.
  - Text comes from `locales/<lang>/verify.json`, following the app's saved language. It is
    built with DOM APIs only (no innerHTML).
  - `vercel.json` rewrites `/verify` and `/verify/*` to it, and a Vite plugin does the same
    in dev and preview.
- **Web**:
  - **Student Skill Passport**: practical and theory tabs with verified badges, certificates
    with Verify links, PDF download, and a Share dialog. The dialog sets the link lifetime,
    creates the link, shows it once with a QR code drawn in the browser, and offers copy. A
    table lists the student's links with views and revoke.
  - **Public shared passport** at `/p/:token`: lazy-loaded, no sign-in, no app chrome, and
    clear "Link no longer active" / "Link not found" states.
  - **Admin certificates register**: Revoke (confirmation plus a reason that is never shown
    publicly) and Reissue (confirmation; the toast shows the new code).
- **Fix found by the e2e test**: on a first, signed-out visit, the failed session check
  cleared the whole query cache, which left public pages stuck on "Loading…". The cache is now
  cleared only when a real session ends.

### Deviations
- **No five-minute shared cache on verification responses.** TAD §8.3 has the response
  cacheable for 5 minutes with the cache purged on revocation, but Vercel's CDN can't be
  purged per key from the app. Responses are `Cache-Control: no-cache` with an ETag: browsers
  and proxies revalidate cheaply (304), and a revocation shows on the very next scan, as
  BRQ-15.4 requires ("changes immediately").
- **The passport PDF is generated by the API**, at `/students/:id/passport.pdf` next to the
  other reports, rather than at a bare `/passport/pdf`.
- **Public pages omit the verifying trainer's name.** It appears in the signed-in passport and
  the PDF.
- **Reissue is only from VALID**; a revoked certificate is not reissued.

### Known gaps / follow-ups
- Photos (`students.photo_url`) exist in the schema but there is no upload yet (F18 evidence
  storage in Sprint 11 could carry it).
- The admin can revoke a competency verification through the API; a screen for it would sit
  in the Sprint 10 audit viewer.

### Definition of done
- [x] API: valid → whitelisted keys; unknown/malformed → 404 (TC-18); revoked → date, no
      reason; reissue → old SUPERSEDED and linked, enrollment stays CERTIFIED; 31st public
      request → 429; passport practical/theory/certificates; trainer reads it, other student
      403; admin revokes a verification (trainer 403), kept on record; share token hashed,
      public keys pinned and no forbidden fields; revoked/expired → 410, unknown → 404;
      lifetime above the maximum → 422; owner-only revoke
- [x] e2e (desktop + mobile, axe on the verify page, passport and public passport): QR target
      shows Valid with the name; unknown ID → Not found; student shares (link plus QR), the
      link opens without sign-in; revoked link → "Link no longer active"; admin revokes the
      certificate → verify shows Revoked without the reason
- [x] 272 API tests (34 suites) · 35 e2e · lint · format · typecheck · build · i18n keys in sync ·
      openapi.yaml (91 paths)

---

## Sprint 8 — Competency model and Gap Analyzer, F12 (done, 2026-10-23)

Release 2 starts here; Gate 1 passed on the live site first (Sprint 7).

### Built
- **Pure rules** (`competency/rules.ts`):
  - `provisionalLevel`: linked-assessment % → level from the new setting
    `competency.provisionalBands` (L2 40, L3 60, L4 85; below 40 → 1).
  - `demonstrated`: the trainer's rating wins; otherwise a provisional level from the average
    of the linked results; otherwise NOT_ASSESSED.
  - `gap = max(0, required − demonstrated)` (BR-18); a not-assessed competency counts as the
    full required level.
  - `canVerify` (BR-13).
  - Boundary tests: 39.99/40, 59.99/60, 84.99/85, equal level → 0, one below → 1, and the BRD
    acceptance case (level 1 on a required 3 → 2).
- **Module boundary test**: no core module may import an innovation module (CLAUDE.md rule
  5); it scans the imports and fails the build otherwise.
- **`modules/competency`** (innovation; reads core only through the batches, assessments and
  courses services):
  - **Competencies** (BRQ-C.1, Admin): `GET/POST /courses/:id/competencies` (GET also for
    trainers), `PUT/DELETE /competencies/:id`.
    - Codes are upper-cased and unique per course (409 `COMPETENCY_CODE_TAKEN`).
    - Linked assessments must come from this course's batches (422
      `ASSESSMENT_NOT_IN_COURSE`); `GET /courses/:id/linkable-assessments` lists them.
    - A competency with ratings can't be deleted (409 `HAS_RATINGS`). Everything is audited.
  - **Learning resources** (BRQ-12.3): `GET /courses/:id/resources`, `POST /resources`,
    `PUT/DELETE /resources/:id` (creator or admin), `POST /resources/:id/approve` (admin).
    - An admin's resource is approved at once.
    - A trainer's resource, or a trainer's edit, waits for approval.
    - Students only ever see approved ones.
  - **Ratings** (BRQ-C.2, BR-13): `GET/PUT /batches/:id/competency-ratings`. Writing is the
    batch's assigned trainer only; admins and other trainers get 403.
    - One transaction. Students must be in the roster (422 `NOT_IN_BATCH`) and competencies
      in the course (422 `COMPETENCY_NOT_IN_COURSE`).
    - `verify` works only at or above the required level (422 `BELOW_REQUIRED_LEVEL` listing
      every offending cell; nothing saved).
    - A verified rating can be raised but never set below the required level (409
      `VERIFIED_LOCKED`; ratings are never deleted).
    - Each change is audited (`COMPETENCY_RATED`, `_RATING_UPDATED`, `_VERIFIED`).
  - **Gaps** (BRQ-12.1–12.3): `GET /students/:id/gaps` (`me`; the student, their trainers,
    admins) for the latest batch or `?batchId=`. It returns belowLevel and notAssessed
    (largest gap first, mandatory first on ties, each with approved resources) and met.
  - **Heatmap** (BRQ-12.4): `GET /batches/:id/competency-heatmap` gives level, source,
    verified, gap and a `below` flag per cell.
  - `competency.mandatoryGaps(studentId, batchId)` is exported for F11 (Sprint 10).
- **Web** (`features/competency`, new `competency` namespace; nav items for all three roles):
  - **Admin Competencies**: course picker, competency table with an edit dialog (code, type,
    title, required level, mandatory, linked assessments as a checklist grouped by batch),
    delete when unrated, and the resource library with approve.
  - **Trainer Competencies**: batch picker and three tabs.
    - **Ratings**: a students × competencies grid. Each cell has a labelled level select whose
      options carry the rubric; the rubric legend sits above the grid. "Verify" appears only
      once the level reaches the requirement, and verified cells show ✓.
    - **Heatmap**: colour plus text in every cell ("L1 · gap 2", `*` = provisional, ✓ =
      verified), a legend, and per-competency counts of students below level.
    - **Resources**: the shared resource library.
  - **Student My skill gaps**: per competency, a level meter (required marker, figures in
    text), the ranked gap list with recommended links, plus not-assessed and met lists.
- **Seed** (`seed/competency.ts`, idempotent):
  - 10 competencies each for Electrician, Solar PV and Tailoring, with realistic titles (e.g.
    "Wire a single-phase distribution board", "Test earthing resistance").
  - The Electrician ones are linked to the pilot batch's three assessments.
  - 53 approved resources: a video search and a reference page per competency, plus a
    practice task and a remedial session.
  - Pilot ratings by trainer1: everyone verified on E01. Students 021–028 are verified at 3 on
    E04/E06; 029 is at 2 and 030 at 1, which is the BRD acceptance case (gap 2) on the live
    demo.
- **Fix**: the tab row no longer shows a stray vertical scrollbar (`overflow-y-hidden`).

### Deviations
- **No "drawer"**: the competency and resource forms use the existing accessible dialog.
- **Ratings are keyed per student, competency and batch**, with "latest" being the current
  row; the audit log keeps every earlier value.
- **Verification can't be undone from the grid.** Revoking a verified competency comes with
  the passport rules in Sprint 9 (BR-14).
- **Ratings are allowed only while the batch is ACTIVE.**

### Known gaps / follow-ups
- F11 flags from mandatory gaps (BR-18 second half) arrive in Sprint 10, using
  `mandatoryGaps`.
- Linked assessments are per batch; a new batch's assessments must be linked again in the
  editor.

### Definition of done
- [x] Unit: provisional bands, demonstrated level, gap (0, 1, 2 BRD case, not assessed),
      verification rule, module boundary
- [x] API: CRUD, unique codes, foreign links, delete guard, bulk ratings, verify below
      required → 422 with nothing saved, verified lock, other trainer / admin / student →
      403, stranger in roster → 422, gaps with only approved recommendations, provisional
      level from marks, student privacy, heatmap flags every student below level
- [x] e2e (desktop + mobile, axe on all three pages): admin defines a level-3 competency and a
      resource → trainer rates level 1 (no verify offered) → heatmap "L1 · gap 2" → student
      sees "Gap: 2 levels" with the resource
- [x] 264 API tests (33 suites) · 33 e2e · lint · format · typecheck · build · i18n keys in sync ·
      openapi.yaml (82 paths)

---

## Sprint 7 — Reports, dashboards, end-to-end → GATE 1 (done, gate passed, 2026-10-23)

### Built
- **Figures owned by each module, aggregated in SQL** (rule 5: the dashboard and reports call
  service functions and never read other modules' tables):
  - `users.activeCounts`, `courses.activeCourseCount`, `batches.statusCounts` and
    `enrollments.statusCounts(cycleId?)` (group-bys).
  - `documents.gradeDistribution` / `batchGrades`.
  - `attendance.weeklyTrend`: one SQL query, weeks start on Monday in institution time, and
    LATE counts as attended when the setting says so.
- **Reports** (`modules/reports`, BRQ-8.1, 8.2):
  - `GET /reports/students/:id.pdf` (`me` works): attendance, results, aggregate and grade
    (the certificate snapshot once certified, otherwise projected), trainer evaluation and
    milestones. Only the student or an admin may download it (new resolver
    `owns.studentSelf`; trainers get 403, per BRD §12.2). Each download stores a
    `PerformanceReport` snapshot plus an audit row (rule 9).
  - `GET /reports/batches/:id?format=csv|pdf` (the batch's trainers or an admin): attendance,
    marks per assessment (CSV), aggregate, grade, status and certificate ID per student.
  - `GET /reports/courses/:id?format=csv|pdf` (admin): students, in training, completed, not
    completed, completion rate and grades A–D per batch, plus a total row.
  - **Completion rate** = completed ÷ (completed + not completed); it's a pure, unit-tested
    rule.
  - **CSV**: RFC 4180 with a UTF-8 BOM (so Excel shows Odia and Hindi), and cells starting
    with `= + - @` are defused against CSV injection.
  - **PDFs**: shared PDFKit helpers (`documents/pdf.ts`) give paged tables with repeated
    headers and "page X of Y" footers, using the same embedded Noto fonts as certificates.
- **Dashboards** (`modules/dashboard`, BRQ-9.1–9.3), each limited to its own role:
  - `/dashboard/admin` (optional `cycleId`): counts, enrollment funnel, completion, grades,
    an 8-week attendance trend and the attendance minimum.
  - `/dashboard/trainer`: active batches and students, today's sessions, sessions still to
    mark, and students below the minimum.
  - `/dashboard/student`: application status, live attendance, aggregate and projected
    grade, next session and certificate.
- **Web**:
  - **Admin dashboard**:
    - Five KPI tiles.
    - Three Recharts charts, each with one series in the reference-palette blue, which
      passes the dataviz validator: applications by status (bars), grades on certificates
      (columns) and weekly attendance (line with the minimum as a reference line).
    - Each chart has hover tooltips and a "Show as table" alternative; screen readers get
      the table.
    - The charts chunk (Recharts, 113 kB gzip) loads only after the figures arrive and only
      for admins.
  - **Trainer dashboard**: tiles, today's and pending sessions with "Take attendance", and a
    low-attendance table.
  - **Student dashboard**: a "My figures" card with the performance report download (next to
    the certificate and batch cards).
  - **Admin Reports page**: batch and course CSV/PDF, plus a performance report per student.
  - Batch report buttons on batch detail (trainer and admin), and a report button on My
    training.
- **Catalogue `?cycle=`**: the catalogue, course detail and apply pages accept a cycle, so
  students can apply in any open cycle, not only the newest.
- **Mobile fixes found by the Gate 1 test**:
  - Absolutely positioned `sr-only` header labels inside table scroll areas widened every
    page with a table to ~620 px on phones (now `relative`).
  - Tab rows now scroll sideways.
  - Dialogs never outgrow the screen (body scrolls, title and buttons stay visible).
- **Global rate limit configurable**: `GLOBAL_RATE_LIMIT_PER_15MIN` (default 1000, unchanged).
  The e2e servers use 50 000, because the whole suite comes from one IP and was being
  refused (429).

### NFR-04: core tasks within three clicks of the dashboard
| Role | Task | Clicks from the dashboard |
| --- | --- | --- |
| Admin | Users, Courses & cycles, Enrollments, Batches, Completion, Certificates, Reports | 1 (sidebar or quick link) |
| Admin | Open an enrollment window | 2 (Courses & cycles → Edit window) |
| Admin | Approve an application | 2 (Enrollments → Approve) |
| Admin | Run allocation | 2 (Batches → Run allocation) |
| Admin | Approve completion | 2 (Completion → pick batch → Approve: 3) |
| Admin | Download a batch or course report | 2–3 (Reports → pick → CSV/PDF) |
| Trainer | Take attendance for a pending session | 1 ("Take attendance" on the dashboard) |
| Trainer | Enter marks | 2 (Assessments → Enter marks) |
| Trainer | Final evaluation | 3 (My batches → batch → Evaluations tab; the dialog opens on the 4th click) |
| Student | Apply for a course | 2 (Courses → Apply) |
| Student | Track application | 1 (My enrollment) |
| Student | Attendance, results, grade | 0 (on the dashboard) / 1 (My training) |
| Student | Download certificate / performance report | 1 (button on the dashboard) |

### GATE 1 checklist
- [x] **Full workflow passes on the deployed build.** `e2e/gate1.spec.ts` passed against
      https://kiss-vtmp.vercel.app on 2026-10-23 in 45.7 s (GitHub Actions workflow "Gate 1 on
      the live site", run 39934353358, started by hand). It also passes locally on desktop and
      mobile, with axe on the admin and student dashboards. The journey: admin opens the
      window → student applies → admin approves → allocation preview/confirm → trainer,
      sessions, activation → trainer marks every session, marks and evaluation → admin
      approves completion → student downloads certificate and report. The run left its test
      data on the live demo: a "Gate 1 …" cycle, a "Motor rewinding …" course, its batch and
      one certified test student (`e2e-gate-…@kiss-vtmp.test`).
- [x] **Every R1 Must BRQ (BRD §8) is ticked with the test that proves it:**

| BRQ | Proved by |
| --- | --- |
| 1.1 Log in and out | `auth.int` (TC-01, TC-02, lockout, rotation), `e2e/auth` |
| 1.2 Own dashboard, server-enforced | `dashboard.int` (each role only its own), `ownership.int`, TC-15 in `completion.int` |
| 2.1 Course CRUD | `courses.int`, `gate1.int` |
| 2.2 Course details | `courses.int` (catalogue), `e2e/enrollment` |
| 2.3 Open and close electives | `courses.int` (window states), `courses/rules` unit, `e2e/gate1` step 1 |
| 3.1 Up to three ranked choices | `enrollments.int`, `e2e/enrollment`, `e2e/gate1` |
| 3.2 One active enrollment, window only | `enrollments.int` (TC-03, TC-04), `constraints.int` (BR-01 index) |
| 3.3 Approve, reject, waitlist (bulk) | `enrollments.int` (TC-05, bulk rollback), `e2e/gate1` |
| 3.4 Status and reasons | `e2e/enrollment` (status, notification), `enrollments.int` timeline |
| 4.1 Batches | `batches.int`, `e2e/batches` |
| 4.2 Allocation with preview | `allocation.int`, `batches/rules` unit, `e2e/batches`, `e2e/gate1` |
| 4.3 Trainers and sessions | `batches.int`, `e2e/gate1` |
| 4.4 Capacity and waitlist | `batches/rules` unit (capacity), `batches.int` (TC-06, TC-07), `allocation.int` |
| 5.1 Mark own batches only | `attendance.int` (TC-08), `e2e/training`, `e2e/gate1` |
| 5.2 48 h edit window, admin override | `attendance/rules` unit (47:59/48:00/48:01), `attendance.int` (override with reason) |
| 5.3 Attendance % and absenteeism | `attendance/rules` unit (74.99/75), `attendance.int`, `dashboard.int` (low attendance) |
| 6.1 Assessments | `assessments.int` |
| 6.2 Marks 0..max | `assessments.int` (TC-10, nothing saved on error), `constraints.int` (DB trigger), `e2e/training` |
| 6.3 Milestones and evaluation | `assessments.int`, `e2e/gate1` |
| 6.4 Weighted aggregate and grade | `assessments/rules` unit (band boundaries), `e2e/training` (90 % → A) |
| 7.1 Eligibility | `completion/rules` unit (TC-13, TC-14, 39.99/40), `completion.int` |
| 7.2 Certificate after approval, random ID, PDF | `completion.int` (TC-16, TC-17, idempotent, retry), `documents` unit, `e2e/completion`, `e2e/gate1` |
| 7.3 Register of certificates | `completion.int` (register search), `e2e/completion` |
| 8.1 Student report PDF | `reports.int` (snapshot, access), `e2e/gate1` (student download) |
| 9.1 Admin counts | `dashboard.int`, `e2e/gate1` |
| 9.3 Role dashboards | `dashboard.int` (trainer, student) |
| 9.4 Completion queue with eligibility | `completion.int` (queue with checks) |

  The Shoulds are built too: 1.3 (`users.int`), 8.2 (`reports.int`) and 9.2 (charts).
- [x] **Audit rows for every attendance, marks, enrollment and completion change.**
      `gate1.int.test` runs the workflow through the API and finds ENROLLMENT_SUBMITTED →
      APPROVED → ALLOCATED → ACTIVE, ATTENDANCE_MARKED per session, RESULT_RECORDED,
      EVALUATION_RECORDED, ENROLLMENT_COMPLETED, CERTIFICATE_ISSUED/RENDERED and
      ENROLLMENT_CERTIFIED, each with the acting user.
- [x] **No R2 work started.**

### Deviations
- **Trainers can't download a student's performance report** (BRD §12.2 lists Student and
  Admin); they have the batch report.
- **Dashboard windows (8-week trend, 14-day pending lookback) are display choices, not
  business thresholds**, so they are constants rather than Settings.
- **Completion rate leaves students in training out**, so an unfinished batch isn't shown as
  failing.
- **Report PDFs are not stored**, only their snapshot; each download re-renders from live
  data, while certificates keep their stored PDF.

### Known gaps / follow-ups
- Each live Gate 1 run adds a set of test data to the demo; run it only when needed.
- Charts are light-only (the app has no dark theme yet).
- The batch report PDF shows a count of recorded assessments, not each mark (those are in the
  CSV), to stay readable with many assessments.

### Definition of done
- [x] 242 API tests (31 suites) · 31 e2e (desktop + mobile, axe) · lint · format ·
      typecheck · build · i18n keys in sync · openapi.yaml (72 paths)

---

## Between Sprints 6 and 7 — Leftovers (done, 2026-10-23)

### Built
- **Word TAD** (`docs/KISS_VTMP_TAD_v1.0.docx`) now names the storage chosen in Sprint 6: a
  private Vercel Blob store, in Amendment 1, the technology table (File storage), §11
  Deployment architecture and the environment-variable list (`BLOB_READ_WRITE_TOKEN`,
  `STORAGE_DRIVER`). `docs/TAD.md` got the same two missing sentences. The file passes schema
  validation and keeps all 633 paragraphs.
- **Route-level code splitting (NFR-10)**:
  - Every page is a `React.lazy` chunk, loaded when first opened. The shell, login and 404
    stay in the main bundle, and `AppShell` shows a spinner while a page loads.
  - Libraries go into separate long-cached chunks (`vendor-react`, `vendor-forms`,
    `vendor-i18n`, `vendor-query`), so a release only re-downloads the app chunk.
  - Before: one 932 kB main file. After: app 69 kB (16 kB gzip) + vendor 602 kB
    (184 kB gzip, cached between releases) + each page 3–44 kB.
  - Sprint 7's chart library (Recharts) will load only on the dashboard and report pages.

### Deviations
- Code splitting was planned for Sprint 12 and was done now, before Sprint 7 adds charts.

### Definition of done
- [x] 29 e2e (desktop + mobile, axe) · lint · format · typecheck · build · i18n keys in sync

---

## Sprint 6 — Completion engine and certificates (done, 2026-10-23)

### Built
- **Eligibility** (`completion/rules.ts eligibility`, pure, BR-09): four checks, each reported
  with passed / actual / required, so the admin sees every reason at once (BRQ-9.4):
  attendance ≥ `attendance.minPercent`, every mandatory assessment recorded, aggregate ≥
  `aggregate.minPercent`, trainer recommendation. Boundary tests: 74.99/75.00 (TC-13, TC-14),
  39.99/40.00, null attendance/aggregate, missing mandatory, no or negative recommendation.
- **Completion** (`modules/completion`, Admin only):
  - `GET /completions/queue?batchId=`: everyone in training or finished, with live figures,
    projected grade, the checks, status, reason and certificate.
  - `POST /completions/:enrollmentId/approve` (Idempotency-Key), exactly per TAD §8.1:
    - It recomputes eligibility and answers 409 `NOT_ELIGIBLE`, with the failing checks as
      details, without saving anything.
    - Otherwise, in ONE transaction, the enrollment goes ACTIVE (or NOT_COMPLETED) →
      COMPLETED and the certificate row is created, with snapshots of grade, aggregate and
      attendance. Audit rows and the student notification are written in the same
      transaction.
    - After commit, the PDF is rendered and stored, and the enrollment goes → CERTIFIED.
    - If rendering fails, the student stays COMPLETED and the response says
      `rendered: false`. `POST /certificates/:id/render` retries, and is safe to repeat.
    - Approving again with a new key gives 409 `ALREADY_COMPLETED`. Concurrent approvals are
      stopped by the conditional status update and the one-VALID-per-enrollment index.
  - `POST /completions/:enrollmentId/not-completed {reason}`: ACTIVE → NOT_COMPLETED, with an
    audit row and a notification. Approve can revisit it later if the student becomes
    eligible.
- **Documents** (`modules/documents`):
  - **Public code** (BR-10, BR-19): 80 bits from `crypto.randomBytes`, written as 16 Crockford
    base32 characters (no I/L/O/U). It's unique in the DB and never derived from a record.
  - **PDF** (ADR-06): PDFKit, A4 landscape. It has the institution (new setting
    `institution.name`), student, roll no, course, batch dates, grade with aggregate and
    attendance, issue date, certificate ID, two signature lines, and a QR code of
    `PUBLIC_BASE_URL/verify/<code>` (the page itself is Sprint 9).
  - **Fonts**: Noto Sans (Latin) and Noto Sans Oriya are embedded from `apps/api/assets/fonts`
    under OFL. Odia names switch fonts automatically and render with correct conjuncts.
  - **Register and student endpoints**: `GET /certificates` is the admin register (search by
    name, roll or code; status filter; paginated). `GET /certificates/:id` and
    `/certificates/:id/download` are for the owner student or an admin only (new resolver
    `owns.certificate`; trainers get 403, TC-17). `GET /students/me/certificates` lists a
    student's own.
- **Storage** (`core/storage`, ADR-10): a `put`/`get` adapter. Development uses local disk
  (`STORAGE_LOCAL_DIR`, git-ignored; tests use the OS temp folder). Production uses a
  **private Vercel Blob store** (`STORAGE_DRIVER=vercel-blob`, `BLOB_READ_WRITE_TOKEN`). The
  DB keeps only the object key. The unused S3 variables are gone.
- **Vercel bundle**: `includeFiles` now also ships the fonts and PDFKit's font metrics.
- **Web** (`features/completion`, new `completion` namespace):
  - **Admin Completion**: cycle and batch pickers, deep link `?batch=` from a new "Completion"
    button on batch detail. The checklist uses ✓/✗ plus words, so colour is never the only
    signal. Actions: approve (single, or selected one after another), not completed (reason
    dialog pre-filled from the failing rules), retry, download.
  - **Admin Certificates register**: search, status filter, paging, download.
  - **Student**: a certificate card on the dashboard, a My certificates page with download,
    and the reason shown when training was not completed.
  - Downloads go through the API client with the in-memory token (`api.blob`), never a bare
    link.
  - Notifications: `TRAINING_COMPLETED`, `TRAINING_NOT_COMPLETED`, `CERTIFICATE_ISSUED`.
- **Seed**: `seedCompletionReadiness` gives the pilot batch's final paper its marks and records
  the trainer's evaluations. Students 021–028 become eligible (grades A–C) and 029–030 are not
  (attendance, not recommended). It fills only what is missing.

### Deviations
- **Storage is a private Vercel Blob store** (TAD left Blob vs Neon open). It's on the
  existing Vercel account, with no card or new service. `docs/TAD.md` §4/§11 and
  `docs/DEPLOYMENT.md` (new step 3a) are updated. The Word TAD still says "chosen in
  Sprint 6".
- **Codes are 16 characters, not the TAD's 12.** 12 is the minimum (BR-19), and 16 base32
  characters carry exactly 80 random bits.
- **Bulk approval runs one request per student** from the browser, not one bulk endpoint,
  because each approval renders a PDF inside the 30 s function limit.
- **`AppError.conflict` now accepts details**, so 409 `NOT_ELIGIBLE` can list the failing
  rules.
- **Approve also works from NOT_COMPLETED**, so a decision can be revisited after marks are
  corrected.

### Known gaps / follow-ups
- Revoke / reissue (BR-19 statuses REVOKED/SUPERSEDED) and the public verify page come in
  Sprint 9. The register already shows the status.
- Certificates are English-only for now (TAD §15 fallback); only Odia names are typeset in Odia.
- Main JS bundle keeps growing (now ~930 kB minified). Route-level code splitting is due.

### Definition of done
- [x] A seeded or freshly trained student goes from approval to a downloadable certificate PDF
      (Playwright desktop + mobile: admin queue with checklist, approve, not completed with
      reason, register search; student dashboard card and PDF download; axe on queue,
      register and student dashboard)
- [x] Unit: eligibility boundaries (TC-13, TC-14, 39.99/40.00, missing mandatory, no
      recommendation), public code format and uniqueness (20 000 codes), PDF renders with
      embedded fonts
- [x] API: ineligible → 409 with nothing saved; TC-16 approve → COMPLETED + certificate →
      CERTIFIED with audit trail and notifications; idempotent replay → one certificate; render
      failure → retry; TC-17 own download only (other student and trainer 403); TC-15 queue
      403 for student/trainer; not-completed with reason; DB rejects a duplicate code
- [x] 229 API tests · 29 e2e · lint · format · typecheck · build · i18n keys in sync ·
      openapi.yaml (66 paths)

---

## Sprint 5 — Attendance, assessments, progress and evaluations (done, 2026-10-19)

### Built
- **Pure rules** (unit-tested at the boundaries):
  - `attendance/rules.ts`: `isAttended` (LATE counts when `attendance.lateCountsAsPresent`),
    `attendancePercent` (two decimals, null before any conducted session; 74.99 vs 75),
    `consecutiveAbsences`, `attendanceFigures`, `editWindow` (47 h 59 / 48 h 00 / 48 h 01).
  - `assessments/rules.ts`: `weightedAggregate` (Σ(marks/max·weight)/Σweight·100),
    `gradeBand` (inclusive lower bounds from `grade.bands`; 84.99/85, 69.99/70, 54.99/55,
    39.99/40), `resultPercent`.
- **Attendance** (`modules/attendance`, BRQ-5.1–5.3, BR-05, BR-06, BR-08):
  - `GET/PUT /sessions/:id/attendance` (trainer of the batch or admin). The session must have
    started and not be cancelled, and the batch must be ACTIVE. Entries must match the roster
    exactly (422 `ROSTER_MISMATCH`).
  - The trainer can edit for `attendance.editWindowHours` (48) from the first save, then gets
    409 `EDIT_WINDOW_CLOSED`. An admin can still change it with a reason (422
    `REASON_REQUIRED`), audited as `ATTENDANCE_OVERRIDDEN`.
  - One transaction locks the session, writes only new or changed rows, audits each with
    old/new (`ATTENDANCE_MARKED` / `_EDITED`), and moves the session SCHEDULED → CONDUCTED.
  - Figures are computed in SQL on read: `GET /batches/:id/attendance-summary`,
    `GET /students/:id/attendance` (`me` works). `GET /sessions/mine` lists a trainer's
    sessions with how many students are marked.
- **Assessments** (`modules/assessments`, BRQ-6.1–6.4, BR-07):
  - CRUD under `/batches/:id/assessments` and `/assessments/:id`. Max marks can't drop below
    a recorded mark (409 `MAX_BELOW_RESULTS`); an assessment with marks can't be deleted (409
    `HAS_RESULTS`).
  - `GET/PUT /assessments/:id/results`: any subset of the roster in one transaction. All
    out-of-range rows come back together (422 `MARKS_OUT_OF_RANGE`, student id per row) and
    nothing is saved. Unchanged rows are skipped; others are audited `RESULT_RECORDED` /
    `RESULT_UPDATED`.
  - Progress notes (`/batches/:id/progress`, whole batch or one student) and final
    evaluations (`GET /batches/:id/evaluations`, `GET/PUT /enrollments/:id/evaluation`; the
    enrollment must be ACTIVE, else 409 `NOT_IN_TRAINING`). Both are audited.
- **My training** (`modules/training`): `GET /students/:id/training` composes the batches,
  attendance and assessments services: attendance figures and minimum, session history,
  results, weighted aggregate and projected grade (BR-11), and the trainer's evaluation.
- **Web** (`features/training`):
  - **Trainer**: Sessions (today / upcoming / past with "Take attendance"); attendance sheet
    (one radio group per student, "Mark all present", live counts, edit-window notice, lock
    reasons, admin reason field after the window); Assessments (batch selector, table,
    add/edit dialog, delete when no marks); marks entry (0..max checked as you type, server
    errors mapped back to the row).
  - **Batch detail** (admin and trainer) gains Attendance, Assessments, Progress and
    Evaluations tabs once the batch is active, and attendance links on started sessions.
  - **Student**: My training with an attendance ring (red below the minimum), aggregate and
    projected grade, evaluation, results and session history. These queries are never
    served from cache (BO-4).
- **Seed**: "Pilot batch" (Electrician, trainer1) in a "Pilot cycle (demo)" that began four
  weeks ago. Students 021–030 are ACTIVE in it; past sessions every other day are conducted
  and marked (the last two students fall below 75 %), two of three assessments have marks,
  and there are two progress notes. Re-seeding skips it.

### Deviations
- No new migration: Sprint 1 already created every table and DB check (BR-07 trigger,
  `first_marked_at`).
- The BRD (BRQ-5.2) doesn't say when the 48 h start. We count from the session's first save
  (`first_marked_at`), so a sheet marked late still gets the full window.
- Trainers save a whole sheet at once, so a partly marked session can't exist. Marks, by
  contrast, can be saved for any subset of students.
- Attendance summary does not flag students below the minimum; My training does. The batch
  view gets risk flags in Sprint 10.

### Known gaps / follow-ups
- Evaluations aren't yet tied to completion. Sprint 6 uses them with attendance and aggregate
  for eligibility and certificates.
- Main JS bundle 904 kB (232 kB gzip); route-level code splitting is getting due.

### Definition of done
- [x] Trainer marks attendance and enters marks (inline range error first); the student sees
      100 % attendance, 45 / 50, aggregate 90.00 % and grade A at once (Playwright desktop +
      mobile, axe on the sheet, marks page and My training)
- [x] API: TC-08, TC-10, TC-11, TC-12, roster mismatch, window boundaries, admin override with
      reason, live figures, My training aggregate → grade, 403 for other trainers' sessions
- [x] 207 API tests · 27 e2e · lint · format · typecheck · build · i18n keys in sync ·
      openapi.yaml (58 paths)

---

## Sprint 4 — Batches, allocation engine, trainers, sessions (done, 2026-10-19)

### Built
- **Allocation engine** (`modules/batches/rules.ts allocate`, pure, O(n log n + n·p)):
  - Applicants are sorted once by `allocation.priorityRule`: submission time, or CGPA desc
    with submission time and then id breaking ties, so results are deterministic.
  - It fills rank 1 for everyone, then rank 2 for anyone still unplaced, then rank 3 (BR-04).
    Each student goes to the batch of that course with the most free seats, so batches fill
    evenly.
  - No batch exceeds capacity (BR-03), and the overflow is waitlisted.
  - Tested for capacity, rank order, both rules, ties, spreading and 500 applicants < 5 s (BO-3).
- **Preview → confirm** (`allocation.service`):
  - Preview stores a snapshot in `allocation_previews` (serverless-safe) with a fingerprint of
    the approved applications (incl. `updatedAt`), batch capacity/status/members and the rule.
    It expires after setting `allocation.previewTtlMinutes` (30).
  - Confirm locks the cycle's batches, recomputes the fingerprint (409 `PREVIEW_STALE` on any
    change) and, in ONE transaction:
    - bulk-inserts the memberships;
    - sets APPROVED → ALLOCATED (or ACTIVE if the batch is active), and the overflow →
      WAITLISTED with a reason;
    - writes per-application audit rows plus `ALLOCATION_CONFIRMED`, and notifications.
  - Confirm also handles 409 `PREVIEW_EXPIRED` and `PREVIEW_ALREADY_CONFIRMED`, and accepts an
    Idempotency-Key (the UI uses `alloc-<previewId>`).
- **Batches** (`batches.service`):
  - Admin CRUD. Capacity is never below enrolled (409 `CAPACITY_BELOW_ENROLLED`), and names
    are unique per course and cycle.
  - Placement:
    - Place an APPROVED/WAITLISTED applicant ("promote"). The course must be one they chose,
      in the same cycle, with capacity left (409 `BATCH_FULL`, TC-06).
    - Move, with the same checks on the target (TC-07). Batch rows are locked in id order so
      moves cannot deadlock.
    - Remove from a planned batch, which returns the application to APPROVED.
  - Trainers: assign and unassign (an active batch keeps one).
  - Activate: PLANNED → ACTIVE, which needs a trainer. Students go ALLOCATED → ACTIVE and are
    notified.
  - Sessions: single, or weekly recurring (days, HH:MM, from/until) expanded in institution
    local time (new setting `institution.utcOffsetMinutes` = 330, IST). Sessions must lie within
    the batch dates (≤ 200 per schedule). Cancel is supported.
  - Read endpoints `/batches/mine`, `/batches/:id` and `/batches/:id/sessions` are
    ownership-checked: admin any batch, trainer their own (BR-05), student their own batch with
    the roster hidden (NFR-08).
- **Enrollments service exports for batches** (rule 5: batches never touch enrollment tables):
  - `approvedApplicants`, `placementFacts` and `candidatesForCourse`.
  - Set-based `changeStatuses(tx, log, …)`: conditional grouped updates, abort on any
    concurrent change, and bulk audit via the new `log.many()` / `audit.recordMany()`.
- **Catalogue seats** now = students placed in the course's batches + approved first choices
  not yet placed.
- **Web**:
  - **Admin**: Batches list (filters, fill bars, create), Run allocation (stats, warnings,
    batch fill with "added now", placements, waitlist, confirm dialog) and Batch detail
    (accessible tabs: Students with place/move/remove and candidate list, Trainers with
    assign/unassign, Sessions with list/calendar toggle, schedule dialog and cancel; edit;
    activate).
  - **Trainer**: My batches and a read-only batch detail.
  - **Student**: a dashboard card with batch, trainer, venue and next session.
  - Session times are always shown in IST.
- **Seed**: "Batch A" per demo course in the open cycle with its trainer assigned (Electrician →
  trainer1, Solar → trainer2, Tailoring → trainer3), ready for an allocation demo.

### Deviations
- **Previews are stored in Postgres**, not in memory, because of serverless hosting.
- **Moves and placements are limited to courses the student chose**; that rule isn't in the
  BRD, but it stops placing students in courses they never asked for.
- **The client shows times in Asia/Kolkata**, a constant that mirrors the server setting; a
  different institution time zone would need both changed.
- **Clash and double-booking checks are not here** (Sprint 11, F14).

### Known gaps / follow-ups
- Main JS bundle is still under NFR-10 but growing. Route-level code splitting should come
  soon.
- Removing a student from an ACTIVE batch is blocked; withdrawals mid-training will be handled
  with attendance/completion (Sprint 5–6).

### Definition of done
- [x] Approved students allocated via preview → confirm; the trainer sees the roster; the
      student sees their batch (Playwright desktop + mobile, axe on allocation, batch detail
      and trainer pages)
- [x] Unit: allocation (capacity, rank order, both priority rules, ties, spread, 500 < 5 s),
      recurring schedule (IST, crossing UTC midnight, limits)
- [x] API: stale/expired/double confirm, idempotent replay, 500 applicants preview < 5 s and
      confirm, TC-06 batch full, TC-07 move capacity, remove, promote, wrong course, trainer
      sees only own batches, student without roster, activation rules, sessions
- [x] lint · format · typecheck · build · i18n keys in sync · openapi.yaml (47 paths)

---

## Sprint 3 — Courses, electives and enrollment (done, 2026-10-19)

### Built
- **`modules/courses`**:
  - **Catalogue** (`GET /courses?cycleId=`, `GET /courses/:id`, `GET /cycles`; any signed-in
    user): active courses offered in the cycle with description, duration, prerequisites,
    capacity, indicative seats remaining and window state. The default cycle is the newest one
    with offerings.
  - **Admin**: course CRUD with soft deactivate (409 `COURSE_CODE_TAKEN`), cycles
    (409 `CYCLE_NAME_TAKEN`), and `PUT /admin/cycles/:cycleId/offerings/:courseId` to offer a
    course and set its window and open/close toggle (BRQ-2.3). Every change is audited.
  - **Window rule** (`rules.ts windowState`): the window is OPEN only when the toggle is on AND
    opensAt ≤ now < closesAt. Boundary unit tests cover it.
- **`modules/enrollments`**:
  - **Student**: `POST /enrollments` takes 1–3 ranked, distinct courses. It returns 409
    `ENROLLMENT_WINDOW_CLOSED` if any chosen course is inactive, not offered, toggled off,
    upcoming or past (BR-02), 409 `DUPLICATE_ENROLLMENT` for BR-01 (the DB partial index's
    P2002 is mapped to it), and 422 `TOO_MANY_PREFERENCES` above setting
    `enrollment.maxPreferences`. `PUT /enrollments/:id` and `POST /enrollments/:id/withdraw`
    work only while PENDING and every window is open. `GET /enrollments/me` returns status,
    reason and a timeline built from the audit trail.
  - **Admin review**: `GET /admin/enrollments` (cycle/course/status/search filters, oldest
    first, paginated) and approve/reject (reason required)/waitlist, single or
    `POST /admin/enrollments/bulk` (≤ 200).
    - One transaction for the whole batch: any unknown id (404) or invalid transition (409)
      rolls it all back.
    - A conditional update per row aborts the batch on a concurrent change.
    - Every change writes an audit row and a student notification in the same transaction.
    - Transitions (`rules.ts canReview`): PENDING → APPROVED/REJECTED/WAITLISTED, and
      WAITLISTED → APPROVED/REJECTED.
- **`core/middleware/idempotency`** (reusable): a Postgres-backed Idempotency-Key, scoped per
  user. The 2xx response is stored before it is sent, and a retry gets it back with
  `Idempotent-Replayed: true`. The same key with a different request gives 422
  `IDEMPOTENCY_KEY_REUSED`, and a key still in flight gives 409. On error the key is released.
  Keys are kept 24 h. Used on submit, approve/reject/waitlist and bulk.
- **`modules/notifications`**: `notify(tx, …)` inside the business transaction; `GET
  /notifications/me` (+ unread count), mark one / all read (scoped per user, someone else's →
  404). Stored as `type` + `data` so the web app renders them through `t()`.
- **`core/audit.history()`**: read-only audit trail per record (used for the status timeline).
- **Web**:
  - **Student**: course catalogue (search, "open only", seats badge, window countdown via
    `Intl.RelativeTimeFormat`), course detail, and an apply/edit page with up to 3 ranked
    choices (keyboard-accessible move up/down, not drag-only). My Enrollment has status,
    reason, timeline, edit and withdraw.
  - **Admin**: Courses & cycles (course table and form, activate/deactivate, cycle create,
    per-course window editor with datetime inputs and open toggle) and Enrollments (filters,
    checkboxes, per-row and bulk actions, reason dialog, fresh Idempotency-Key per action).
  - **All roles**: a notification bell with unread count, polling every 60 s.
- **Data**:
  - Migrations add `WITHDRAWN` and `notifications.data`, and rebuild the BR-01 index so it
    also ignores WITHDRAWN (a separate migration, because Postgres can't use a new enum
    value in the same transaction).
  - The seed adds pending applications for students 031–060. Students 001–030 stay free for
    demos and e2e.
- **Docs**: the Word TAD (`docs/KISS_VTMP_TAD_v1.0.docx`) got the same Amendment 1 as
  `docs/TAD.md`, and passes schema validation. Its only Render/Railway mention is the amendment
  note.

### Deviations
- **`WITHDRAWN` status** added, so students can withdraw a pending application and re-apply.
  It doesn't count as active for BR-01.
- **Seats remaining is indicative**: capacity minus approved-or-later applications counted
  against their first preference. Approval isn't tied to a course until allocation, and
  Sprint 4 switches to real batch membership.
- **Notifications are polled** (60 s), not pushed, because there's no long-lived connection on
  serverless hosting.
- The default review filter is PENDING, so the queue opens on work to do.

### Known gaps / follow-ups
- No drag-and-drop ranking: up/down buttons cover the same need accessibly.
- Prerequisites are informational text; nothing checks them automatically (the BRD doesn't
  define a machine-checkable prerequisite).
- Main JS bundle is 769 kB (213 kB gzip). That's within NFR-10's 500 kB transferred, but it
  grows each sprint. Route-level code splitting (planned for Sprint 12) should come earlier if
  it passes ~300 kB gzip.

### Definition of done
- [x] A seeded student applies, the admin approves, and the student sees APPROVED at once
      (Playwright, desktop + mobile, with axe on catalogue, apply, my enrollment and admin pages)
- [x] TC-03 (window closed: closed/off/upcoming/inactive/not offered), TC-04 (duplicate,
      re-apply after withdraw), TC-05 (edit after close; bulk rollback on an unknown id and on
      an invalid transition), audit rows, idempotent replay, notifications
- [x] lint · format · typecheck · build · i18n keys in sync · openapi.yaml (30 paths)

---

## Sprint 2 — Auth, RBAC, ownership, role dashboards, first deploy (done, 2026-10-19)

### Built
- **`core/auth`** (kernel shared by all modules): bcrypt hashing (cost from `BCRYPT_ROUNDS`,
  default 12) with a timing-equalising check for unknown emails; HS256 access JWT, 15 min,
  issuer/audience checked; refresh tokens = 32 random bytes, stored as a keyed SHA-256 hash,
  7 days; `authenticate` reloads the user on every request (deactivation and role changes apply
  immediately); `authorize(...roles)`; `requireOwnership(resolver)` with reusable resolvers
  `isOwnStudent`, `canAccessBatch` (BR-05), `canAccessSession`, `canAccessAssessment` and
  predicates `trainerOwnsBatch`, `trainerTeachesStudent`. Unknown id → 404, someone else's → 403.
- **`modules/auth`**: `POST /auth/login` (generic "Invalid email or password" for wrong
  password, unknown email and inactive account; lockout after `auth.maxFailedLogins` for
  `auth.lockMinutes` → 429 `ACCOUNT_LOCKED`, audited as `USER_LOCKED`; per-IP limit on failed
  attempts), `POST /auth/refresh` (rotation on every use, token families, reuse → whole family
  revoked, race-safe conditional claim), `POST /auth/logout`, `GET /auth/me`. Cookie
  `vtmp_rt`: httpOnly, SameSite=Strict, path `/api/v1/auth`, Secure in production.
- **`modules/users`**: `PATCH /users/me` (name, locale, phone; strict schema blocks role/email
  changes), `POST /users/me/password` (verifies current, signs out other sessions, keeps this
  one), admin `GET/POST/PATCH /admin/users` (search, role/status filters, pagination;
  role-specific create with 409 `EMAIL_TAKEN`/`ROLL_NO_TAKEN`/`EMPLOYEE_CODE_TAKEN`;
  deactivate revokes sessions, reactivate clears lock, no self-deactivation). All writes audited,
  never with password material. Shared Zod schemas in `packages/shared/src/schemas/auth.ts`.
- **Web**: `AuthProvider` (access token in memory only, session restored from the cookie on
  load, proactive refresh 1 min before expiry, single-flight refresh, 401 → refresh → retry
  once), `RequireAuth` (→ `/login?next=`), `RequireRole` (→ 403 page), login page (RHF + shared
  Zod), role layouts with per-role sidebar, account menu, dashboards with quick links, "coming
  soon" pages for later features, profile + change-password pages, admin Users page (search,
  filters, pagination, create modal with role-specific fields, deactivate confirm). Language
  switch is saved to `User.locale` and applied at login.
- **Deploy prep (Vercel + Neon, revised 2026-10-19)**: one Vercel project serves the SPA and
  runs the Express API as a serverless function. Root `vercel.json` routes `/api/*` and
  `/health` to `api/index.js` → `apps/api/dist/vercel.js` (bundled `createApp()`), the rest to
  the SPA, region sin1 next to Neon. `scripts/vercel-build.sh` runs migrations (production only,
  direct URL), then builds API and web. Failed-login limits now use a Postgres-backed store
  (`rate_limits` table, hashed keys, `RATE_LIMIT_STORE`, default postgres in production) so all
  function instances share one count. Also `TRUST_PROXY_HOPS`, `SEED_PASSWORD` override,
  `docs/DEPLOYMENT.md`, and a CI job that smoke-tests the live site once `PUBLIC_BASE_URL` is set.
  Locally and in CI the API still runs as a normal server.

### NFR-04: three clicks from the dashboard
Every navigation entry is one click from each dashboard (sidebar + quick links). Profile and
password are two clicks via the account menu.

### Deviations
- Auth middleware and ownership resolvers live in `core/auth` (kernel), not `modules/auth`,
  so every module can use them without importing another module.
- Per-IP limit counts **failed** logins only (`skipSuccessfulRequests`); refresh is not
  IP-limited beyond the global limiter. Counting every `/auth` call would lock out normal users,
  since each page load refreshes. New setting `auth.ipRateLimitPer15Min` (50).
- Locked accounts get 429 `ACCOUNT_LOCKED` rather than the generic 401, so a real user knows to
  wait. This reveals that a locked email exists; accepted for usability.
- **Hosting: Vercel + Neon only, no Render** (TAD §4/§11 named Render/Railway as examples).
  Render requires a card, and the team's card was declined. Consequences, carried into the
  sprint plan:
  - Rate limits that protect security use the Postgres store (failed logins now; the public
    router in Sprint 9).
  - The Sprint 10 nightly risk job runs from Vercel Cron (once a day on Hobby, may run up to
    ~1 h late), with node-cron kept for local runs.
  - Certificate PDFs and evidence (Sprint 6, 11) go to an object store, because there is no
    persistent disk.
  - Request time is capped at 30 s.
- CI does not push deploys itself. Vercel deploys `main` through its GitHub integration (and
  migrates first), and CI smoke-tests the live site afterwards.
- Refresh in two tabs at the exact same moment can trigger reuse detection and sign both out
  (documented trade-off of strict rotation).

### First deploy (2026-10-19)
- Live at **https://kiss-vtmp.vercel.app** (Vercel Hobby, function region sin1; Neon Postgres
  16, Singapore). Migrations ran in the production build, the demo data was seeded, and admin,
  trainer and student each signed in to their own dashboard. `PUBLIC_BASE_URL` is now fixed.
- Issues fixed on the way:
  - `NODE_ENV` pasted with stray characters failed config validation, so values are now
    normalised.
  - The install now keeps dev dependencies when `NODE_ENV=production`
    (`--production=false`).
  - CORS rejected same-origin POSTs from Vercel per-deployment URLs, so same-origin requests
    now always pass.
- Credentials hygiene:
  - The Neon password was shared in a chat and also used as the first demo password. The
    Neon password has been rotated.
  - All seeded accounts got a new demo password via the new `pnpm db:seed --reset-passwords`
    (audited, revokes sessions).
  - GitHub has the variable `PUBLIC_BASE_URL` and the secret `E2E_PASSWORD`, so CI
    smoke-tests the live site after each push to main.

### Known gaps / follow-ups
- Password reset by email is out of scope (BRD); admins can create accounts and reactivate.

### Definition of done
- [x] lint · format · typecheck · build · i18n keys in sync
- [x] API tests incl. TC-01, TC-02, TC-15, lockout, rotation, reuse detection,
      expired/forged tokens, trainer → other batch 403, shared Postgres rate-limit store
- [x] 17 Playwright tests (desktop + mobile), axe clean on login, dashboards and Users
- [x] openapi.yaml: /auth/*, /users/me*, /admin/users*
- [x] All three roles sign in on the deployed URL (https://kiss-vtmp.vercel.app)

---

## Sprint 1 — Full schema, seed, settings and audit kernel (done, 2026-10-19)

### Built
- **Schema** (`prisma/schema.prisma`, migration `*_r1_r2_schema`): all R1 core tables (TAD §6.1)
  and R2 tables (§6.2) — 31 tables, UUID keys, snake_case, every FK indexed. Additions beyond the
  prompt list: `users.full_name`, `last_login_at`; `refresh_tokens.family_id` + `replaced_by_id`
  for rotation/reuse detection; `training_sessions.trainer_id` (for F14 clash checks);
  `attendance.first_marked_at` (anchors the 48 h window); `risk_flags.clear_since` (BR-17);
  `passport_shares.view_count`. No R3 tables.
- **Database-enforced rules** (raw SQL in the migration): BR-01 partial unique index; BR-07
  marks trigger (plus a guard against lowering `max_marks` below existing results); insert-only
  `audit_logs` (UPDATE/DELETE/TRUNCATE rejected); one open risk flag per student+batch; one VALID
  certificate per enrollment; ≥12-char certificate codes; range CHECKs (rank 1–3, levels 1–4,
  CGPA 0–10, positive capacity/weightage/max marks, ordered dates, `due_on ≥ created`);
  composite FK keeping `batch_students.student_id` consistent with its enrollment.
  Summary with mermaid diagrams in `docs/ER.md`.
- **`core/settings`**: typed registry of 18 thresholds (Zod schema + default + description),
  `settings.get/getMany/all` with a 60 s cache, `settings.set(actor, key, value)` that validates,
  writes and audits in one transaction then clears the cache, `seedDefaults()` that never
  overwrites admin changes. Invalid stored rows fall back to the default with a warning.
  Added `attendance.lateCountsAsPresent` (default true) now, ahead of Sprint 5.
- **`core/audit`**: `audit.record(tx, entry)` refuses the root client so audit rows always share
  the change's transaction; `withAudit(actor, (tx, log) => …)` wraps `prisma.$transaction` with
  a logger bound to the user and IP. Dates/Decimals/BigInts are stored as plain JSON.
- **Seed** (`pnpm db:seed`, idempotent): settings, 1 admin, 4 trainers, 60 students (CGPA
  5.00–9.79, deterministic), one cycle, 3 courses with open windows; `--large` → 500 students.
  Seed logic lives in `apps/api/src/seed` (so it resolves the API's dependencies);
  `prisma/seed.ts` is the entry point.
- **Tests**: 31 new — migrations create every R1/R2 table and no R3 table; audit trigger rejects
  UPDATE/DELETE/TRUNCATE; BR-01 rejects a second active enrollment and allows one after
  rejection; marks > max, negative marks, zero weightage, lowering max rejected; rank and level
  ranges; partial uniques for risk flags and certificates; composite FK; withAudit commit and
  rollback; settings get/set/audit/cache/invalid values; registry defaults.
  Integration tests migrate `vtmp_test` automatically (Jest global setup) and run in band.

### Deviations
- `IdempotencyKey` stores `request_hash`, `response_status` and `response_body` (instead of
  only a response hash) because Sprint 3 must replay the exact response.
- Grade bands are one Setting (`grade.bands`) validated as strictly descending, instead of four.
- Audit writes are explicit `audit.record` calls inside the transaction, not Prisma middleware
  (deprecated `$use`), as the sprint prompt allows.
- `Progress.student_id` is optional so a milestone can apply to a whole batch.

### Known gaps / follow-ups
- The app's DB role still owns `audit_logs`; TAD §6.3 also wants UPDATE/DELETE revoked from it.
  The triggers already block both; a separate least-privilege role belongs with deployment
  (Sprint 2).
- Seed passwords are dev-only and documented in the README.

### Definition of done
- [x] `pnpm db:migrate && pnpm db:seed` on a fresh DB (seed re-run is a no-op; `--large` works)
- [x] lint · format · typecheck · 49 API tests (21 unit + 28 integration) pass
- [x] docs/ER.md · README seed accounts · no new endpoints (openapi unchanged)

---

## Sprint 0 — Monorepo foundation (done, 2026-10-19)

### Built
- **Monorepo** (pnpm workspaces): `apps/api`, `apps/web`, `packages/shared`, `prisma/`.
  Strict TypeScript everywhere from `tsconfig.base.json`; `@vtmp/shared` consumed as TS source.
- **API kernel** (`apps/api/src/core`):
  - `config` — Zod-validated env loader (DATABASE_URL, JWT_SECRET, REFRESH_SECRET,
    PUBLIC_BASE_URL, CORS_ORIGINS, PORT, STORAGE_*, AI_ENABLED, ANTHROPIC_API_KEY,
    AI_MONTHLY_CAP); errors list variable names only, never values.
  - `errors` — `AppError` + central handler; every error is `{ error: { code, message, details? } }`.
    Zod → 422 `VALIDATION_FAILED`, bad JSON → 400 `MALFORMED_JSON`, unknown → 500 `INTERNAL_ERROR`
    (message not leaked), unknown route → 404 `ROUTE_NOT_FOUND`.
  - `http` — `asyncHandler`, pagination (`?page=&pageSize=`, max 100).
  - `middleware` — helmet, CORS allow-list, pino-http (credentials redacted), global rate limiter,
    `validate({ body, query, params })`.
  - `db` — Prisma client with `connection_limit=5` added to the URL; `Tx` type.
  - `audit`, `settings` — placeholders for Sprint 1.
  - `createApp()` separate from `server.ts` (graceful shutdown). Routes under `/api/v1`.
  - `GET /api/v1/health` (and `/health` for uptime pingers): `SELECT 1` with 2 s timeout →
    200 `{status:"ok",db:"ok"}` or 503 `{status:"degraded",db:"error"}`.
  - `openapi.yaml` with info, servers, Error/PageMeta schemas, common responses, `/health`.
- **Prisma**: placeholder `User` model, initial migration, connection-check seed;
  `docker-compose.yml` with `pgvector/pgvector:pg16` and a separate `vtmp_test` database for
  integration tests.
- **Shared**: enums for Role, Locale, EnrollmentStatus (+ inactive set for BR-01), BatchStatus,
  SessionStatus, AttendanceStatus, AssessmentMode, CertificateStatus, RiskLevel, Grade,
  InterventionActionType, LearningResourceType, AllocationPriorityRule, OpportunityType;
  API error/pagination/health schemas.
- **Web shell**: Vite + React 18 + Router + Tailwind + TanStack Query + react-i18next.
  Skip link, top bar with app name and language switcher (persisted), responsive sidebar
  (toggle on mobile), footer, 404 page, error boundary, toast system (live regions).
  Design system in `components/ui`: Button, Input, Select, Table, Card, Badge, Modal (native
  `<dialog>`), EmptyState, Spinner — visible focus states, AA-contrast tones. Fetch API client
  with typed `ApiError`, in-memory token hook for Sprint 2. Home page shows live API/DB status.
- **i18n**: `locales/{en,or,hi}/<namespace>.json` loaded per file on demand via
  `import.meta.glob`; `or`/`hi` are empty copies that fall back to English.
  `i18n:sync` script mirrors new keys; `i18n:check` runs in CI.
- **Tooling**: ESLint 9 flat config (typescript-eslint, react-hooks, jsx-a11y, rule banning
  `dangerouslySetInnerHTML`), Prettier, Jest (unit + integration projects), Playwright
  (desktop + mobile) with axe-core, GitHub Actions CI (quality → unit + integration with
  PostgreSQL → build + e2e; deploy job stubbed).

### Deviations
- Seed is a connection check only; real seed data is Sprint 1 scope.
- `CLAUDE.md` and the sprint prompts are kept locally (git-ignored) by team choice.
- Health also lives at `/health` (outside `/api/v1`) for uptime monitors (TAD §13).

### Known gaps / follow-ups
- Main JS chunk is ~594 kB minified / ~177 kB gzip. Fine for NFR-10 (<500 kB transferred) but
  route-level code splitting is due in Sprint 12.
- Playwright needs `playwright install chromium` once per machine.

### Definition of done
- [x] lint · [x] format · [x] typecheck · [x] build
- [x] tests: 17 unit + 1 integration (real PostgreSQL) · 8 e2e (desktop + mobile, axe clean)
- [x] `pnpm db:up && pnpm dev` → web shows the shell, `GET /api/v1/health` →
      `{status:"ok",db:"ok"}` · migration applies on a clean DB · seed runs
- [x] openapi.yaml · [x] strings externalized · [x] language switcher persists

### Notes for the next session
- Prisma Client is generated by the **root** `postinstall` only. Letting `@prisma/client` and
  `apps/api` both generate during install raced and left an uninitialised client.
