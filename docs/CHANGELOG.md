# Changelog

What changed in the portal, newest first. The reasons and the details of each change are in
[PROGRESS.md](PROGRESS.md); the rules are in [BRD.md](BRD.md) (v1.2) and the design in
[TAD.md](TAD.md) (v1.2, Amendment 3). IDs in brackets are the review findings (S, A, D, T, P from
the site test run; L from the logic review) and the BRD requirements and rules they touch.

## v1.2.2 — low-severity security fixes (2026-11-02)

### Fixed
- `%` and `_` in the user, application and certificate searches are matched as text, not as
  wildcards.
- A request body the server can't read gets 413, 415 or 400 instead of 500.

### Added
- `SEED_ADMIN_PASSWORD`: the demo admin can have its own password, so the shared demo password
  no longer opens the admin account.
- `pnpm db:seed --unlock-admins`: unlocks a locked admin account straight away.

## v1.2.1 — security fixes (2026-11-02)

### Fixed
- Wrong passwords sent at the same moment now all count, so the 5-attempt lock can't be dodged
  by sending guesses in parallel (TC-02).
- Every page now sends browser-protection headers (content security policy, no framing by other
  sites, nosniff, referrer and permissions policies, HSTS).
- `body-parser` updated to 1.20.9 (denial-of-service fix).

## v1.2 — automation (2026-11-01)

The nine manual steps from the Round 2 review, automated (BRD v1.2 Section 8.2, TAD Amendment
3). Branch `automation`, not yet merged.

### Added

- **Automation page** for admins: every switch and limit below, the last nightly run, and
  **Run now**. A new nightly job (03:00 IST) runs the steps in order; one failing step doesn't
  stop the others.
- **A1 auto-close** of finished batches, 7 days after the end date once every student is decided
  (BRQ-4.7).
- **A2 waitlist promotion** when a seat frees up, off by default (BRQ-4.8).
- **A3 daily reminders** to trainers (sessions to mark) and admins (waiting applications,
  undecided ended batches) (BRQ-9.5).
- **A4 notices** to students: applications open, session cancelled, passport link expiring, new
  matching opportunity (BRQ-9.6).
- **A5 CSV import** of students with a check first, all or nothing (BRQ-1.5).
- **A6** eligible students start selected on Completions (BRQ-7.4).
- **A7** automatic approval also applies to waiting applications when its rules change and
  nightly (BRQ-3.6).
- **A8** outcome analytics refresh after certificates when stale (BRQ-20.4).
- **A9** placement follow-up questions to admins after 90 days (BRQ-20.5).

### Technical

- New `automation` module (innovation tier), 11 Settings, 9 notification types, 4 admin
  endpoints and one cron route (`/internal/jobs/daily-automation`), and a `certificateEvents`
  hook on the core event bus. No database migration.
- Word exports of the BRD and TAD regenerated as v1.2 (they replace v1.1).
- Tests: 478 API tests in 57 files and 75 browser tests, all passing. Traceability is 120 of 120
  BRQs and BRs cited by a test.

## v1.1 — after release (2026-10-27 to 2026-11-01)

The changes since Release 3. Not yet merged upstream: the Round 2 fixes and the new seed names
(branches `fix-round2-high`, `fix-round2-medium`, `fix-round2-low`, `seed-unique-names`).
Everything else is in `main`.

### Added

- **Automatic approval** of applications that meet admin-set rules: minimum CGPA, and a
  per-course switch for whether prerequisites need a person (BRQ-3.5, D2).
- **Students choose the training cycle** on the Courses page. Each cycle says whether it takes
  applications, open ones first (BRQ-2.4, L7).
- **Admin clean-up:** lists show active records by default, bulk deactivate and reactivate, and
  safe delete of courses and accounts never used (BRQ-2.5).
- **Account recovery:** admins reset a forgotten password and unlock a locked account. A password
  set by an admin must be changed at the next sign-in (BRQ-1.4, A1, A2, A3, BR-27).
- **Withdraw from training** with a reason the student sees. The student keeps their records,
  frees the seat and leaves sheets, mark entry and risk checks (BRQ-4.5, L4, BR-26).
- **Close a batch** after its end date once every student has a decision. The admin dashboard
  lists ended batches still open (BRQ-4.6, L1, L8, BR-25).
- Applied courses are marked on the Courses page, the latest applications come first, tables
  become cards on phones, list filters are remembered per device, and the Hindi and Odia text
  was reviewed against a glossary.

### Changed (business rules, BRD v1.1)

- **BR-06:** the 48-hour attendance window starts at the first marking or the session's end,
  whichever comes first, so an unmarked session has a deadline too (L3).
- **BR-09:** completion also needs every session that has ended to be marked; unmarked sessions
  no longer inflate attendance (L2).
- **BR-19:** a revoked certificate can be reissued under a new ID (D1).
- **BR-20:** a session that names no trainer counts as taught by its batch's trainers when
  checking clashes (T3).
- **New rules:**
  - **BR-23** no overlapping trainings (S1);
  - **BR-24** batch dates and enrollment windows inside the cycle (L5, L6);
  - **BR-25** closing a batch (L1);
  - **BR-26** withdrawal (L4);
  - **BR-27** passwords and sign-in (A3, A4, A5);
  - **BR-28** a planned or running batch keeps a trainer (D3).

### Fixed

- The rate limit counted a whole campus network as one user; signed-in users are now counted
  one by one (P1).
- Assessments dated outside their batch are refused. The completion check names the mandatory
  assessments still missing marks (T1).
- Students whose account was deactivated drop off new attendance sheets and risk checks (T2).
- Catalogue seats come from the real batches once a course has them (S2).
- Attendance shows two decimals everywhere (S3). The student dashboard stays on the training in
  progress (S4). Dashboard tiles say "accounts" (D6).
- Deactivating a course in use asks first (D4). The Completions page no longer errors before a
  batch is chosen (D5). The analytics page says how many certificates are newer than its
  figures (D7).
- The seed's 60 students had only 55 different names. It now lists 40 unique, realistic names
  (half women, half men, Odisha tribal surnames), and the default seed has 40 students.

### Not changed

- **S5:** already handled; the Assistant page explains when a course has no materials.
- **P2:** a higher limit for public certificate checks would break NFR-09 (30 requests per
  minute per address). The limit is a setting.

### Technical

- 11 new admin endpoints (167 routes in all), each in `openapi.yaml` and the Postman collection.
- One migration: `users.must_change_password` and `courses.prerequisites_need_review`.
- Tests: 455 API tests in 53 files and 71 browser tests, all passing. Traceability is 111 of 111
  BRQs and BRs cited by a test.

## v1.0 — Release 3 (2026-10-26)

The final release of the semester project: F1–F9 (core workflow from enrollment to verifiable
certificate), F10–F12 and F15 (Skill Passport, early intervention, competency gaps, QR
verification), F13, F14 and F16–F20 (opportunities, scheduling advisor, Odia and Hindi, AI
assistant, practical evidence, audit viewer, outcome analytics). See the release note in
PROGRESS.md.
