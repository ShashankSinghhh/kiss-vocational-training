# 10-minute demo

A walkthrough of the journey from choosing a course to a placed student, on the clean seeded
data, then the training and certificate screens. Screenshots of each screen are in the
[user guide](../USER_GUIDE.md).

## Before you start (5 minutes, once)

- **Where:** a local setup (`pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, then
  <http://localhost:5173>) or the live site. Local accounts use `Password@123`; the live password
  is shared privately by the team.
- **The seed** is a clean start: one training cycle open for applications, five programmes with
  30 courses, one planned batch per course with its trainer, 100 students and no applications,
  marks or certificates yet. Locally, `pnpm --filter @vtmp/api db:reset` puts it back.
- **Windows:** one normal window (admin), one private window (student), a phone or the browser's
  phone view (verification).
- **Accounts:** `admin@kiss-vtmp.test`, `trainer1@kiss-vtmp.test` (Computer & Digital Skills),
  `student001@kiss-vtmp.test` … `student100@kiss-vtmp.test`.
- **Automatic approval** (optional): in **Enrollments → Automatic approval**, switch it on before
  the demo so scene 3 approves the moment the student applies.

## Script

| Time | Scene                        | Do                                                                                                                                                                                             | Say                                                                                                                                                                                                                                                             |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | **The problem**              | Open the front page, then **Sign in**. Switch the language to ଓଡ଼ିଆ, then back.                                                                                                                | Vocational records at KISS are on paper and spreadsheets; certificates can't be checked. One portal, in the students' languages, fast on 3G.                                                                                                                    |
| 0:45 | **Programmes**               | Admin: **Courses & cycles**. Show the five programmes and their courses, and the cycle's open windows.                                                                                         | Courses are grouped into programmes; each course runs in its own batch with its trainer.                                                                                                                                                                        |
| 1:45 | **Apply**                    | Student window: sign in as `student001`. **Courses** → choose the cycle → **Computer & Digital Skills** → _Computer Training_ → **Apply** → **Submit application**.                            | A student picks one programme, then one course in it: one application per cycle, only while the window is open (BR-01, BR-02).                                                                                                                                  |
| 3:00 | **Approve**                  | Admin: **Enrollments**. With automatic approval on, it is already _Approved_; otherwise **Approve** it. The student's bell has a notification.                                                 | Rules approve most applications instantly; the rest wait with the reason. Every decision is audited (BR-03).                                                                                                                                                    |
| 4:00 | **Allocate**                 | Apply as two or three more students (`student002`…), then admin: **Batches → Run allocation** → preview → **Confirm allocation**. Open _Computer Training · Batch A_: the students are placed. | Placement by preference and the tie-break rule, checked for capacity and clashes before anything changes (BR-04).                                                                                                                                               |
| 5:30 | **Plan the training**        | In the batch, **Schedule sessions** → _Weekly schedule_ for the term; show the trainer (`trainer1`) and the clash warnings.                                                                    | Trainer clashes and room clashes are caught before the timetable is saved.                                                                                                                                                                                      |
| 6:30 | **Train, complete, certify** | Open the user guide's _Follow your training_, _Trainers_ and _Completions_ screenshots.                                                                                                        | Attendance (editable 48 h, then admin-only with a reason), marks, the at-risk check, and completion: attendance ≥ 75 %, every mandatory assessment, aggregate ≥ 40 % and the trainer's recommendation (BR-06, BR-09, BR-16). Thresholds are settings, not code. |
| 8:00 | **Verify anywhere**          | Open `/verify` on the phone.                                                                                                                                                                   | Employers check a certificate in seconds, without signing in: name, course, grade and date only (BR-15).                                                                                                                                                        |
| 8:45 | **Evidence of it all**       | Admin: **Audit log** → filter entity _Enrollment_.                                                                                                                                             | Every change traceable to who, what and when, and the log can't be edited.                                                                                                                                                                                      |
| 9:30 | **Close**                    | Back to the dashboard.                                                                                                                                                                         | Built and tested: API tests, browser tests on desktop and phone, every requirement traced to its test ([TRACEABILITY.md](../TRACEABILITY.md)).                                                                                                                  |

## If something goes wrong

| Symptom                                  | Fix                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| The live site is slow on the first click | It was asleep (free hosting): wait 2–3 s; later clicks are fast.            |
| _You already have an application_        | That student has applied; use the next one (`student002`, `student003`, …). |
| Nothing to allocate                      | Approve the pending applications first (scene 3).                           |
| Locked account after typos               | Wait 15 minutes or use another seeded account of the same role.             |
