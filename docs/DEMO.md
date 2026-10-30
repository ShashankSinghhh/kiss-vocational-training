# 10-minute demo

A walkthrough of the whole journey, enrollment to a verifiable certificate, using only seeded
data. Screenshots of each screen are in the [user guide](USER_GUIDE.md).

## Before you start (5 minutes, once)

- **Where:** a local setup (`pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, then
  <http://localhost:5173>) or the live site. Local accounts use `Password@123`; the live password
  is shared privately by the team.
- **A fresh seed** gives the cleanest story: a pilot batch in training (students 021–030), 30
  pending applications, 3 courses, competencies, opportunities. Locally:
  `pnpm --filter @vtmp/api db:reset`, then `pnpm db:seed`. Never reset the live database.
- **Windows:** one normal window (admin), one private window (student), a phone or the browser's
  phone view (verification).
- **Accounts:** `admin@kiss-vtmp.test`, `trainer1@kiss-vtmp.test`, `student001@kiss-vtmp.test`
  (not yet applied), `student021@kiss-vtmp.test` (eligible to complete), `student029@kiss-vtmp.test`
  (low attendance).

## Script

| Time | Scene | Do | Say |
| --- | --- | --- | --- |
| 0:00 | **The problem** | Open the sign-in page. Switch the language to ଓଡ଼ିଆ, then back. | Vocational records at KISS are on paper and spreadsheets; certificates can't be checked. One portal, in the students' languages, fast on 3G. |
| 0:45 | **Apply** | Sign in as `student001`. **Courses** → pick *Solar PV Installer* → **Apply**, rank two courses. **My enrollment** shows *Pending*. | One active application per cycle, only while the window is open (BR-01, BR-02). |
| 2:00 | **Approve** | Admin window: **Enrollments** → find student001 → **Approve**. Back in the student window the status is *Approved* and the bell has a notification. | Every decision is audited and the student is told at once. Allocation then places approved students by preference rank (BR-03, BR-04). |
| 3:00 | **Train** | Sign in as `trainer1`. **Sessions** → open the latest *Pilot batch* session → mark one student *Late* → **Save attendance**. Note "you can change this until…". | Attendance is editable for 48 hours, then admin-only with a reason, all logged (BR-06). |
| 4:00 | **Spot who is struggling** | Admin: **At-risk students** → **Run the check now**. Open *Rakesh Naik* (029): attendance 66.67 % and skill gaps, *High*. Add a *Remedial session* action with a due date. | The nightly check flags students early from attendance, marks and skills (BR-16–18), so trainers act before the end of the course. |
| 5:30 | **Complete and certify** | Admin: **Completions** → *Pilot batch*. Show 029 failing on attendance. **Approve** *Sanjukta Kujur* (021): certificate issued, grade shown. | Completion needs attendance ≥ 75 %, every mandatory assessment, aggregate ≥ 40 % and the trainer's recommendation (BR-09). Thresholds are settings, not code. |
| 6:45 | **Verify anywhere** | Open the certificate PDF, scan its QR with the phone (or open `/verify/<ID>`). *Valid*, with name, course, grade, date only. | Employers check a certificate in seconds, without signing in, on an 11 KB page (BR-15, NFR-09). |
| 7:30 | **Revoke** (optional) | **Certificates** → revoke one with a reason → refresh the verify page: *Revoked*, no reason shown. | Revocation is immediate and audited; the reason stays private. |
| 8:00 | **Skill Passport** | Student window: sign in as `student021` → **Skill Passport** → **Share passport** (7 days) → open the link in a private window. | Verified skills across all courses, shared with a link the student controls and can revoke. |
| 8:45 | **Opportunities** | Still as 021: **Opportunities** → match %, missing skills with resources → **I'm interested**. | Skills connect to placements: match % = verified required skills ÷ required skills (BR-22). |
| 9:15 | **Evidence of it all** | Admin: **Outcome analytics** → **Refresh now** (completion rate rises). **Audit log** → filter entity *Certificate*. | Outcomes per course and batch; every change traceable to who, what and when, and the log can't be edited. |
| 9:45 | **Close** | Back to the dashboard. | Built and tested: 381 API tests, browser tests on desktop and phone, every requirement traced to its test ([TRACEABILITY.md](TRACEABILITY.md)). |

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| The live site is slow on the first click | It was asleep (free hosting): wait 2–3 s; later clicks are fast. |
| No "Pilot batch" session to open | Use any past session (*View attendance*); editing still works within 48 hours. |
| 021 is already certified | Approve another of 022–028 instead; all are eligible on a fresh seed. |
| Locked account after typos | Wait 15 minutes or use another seeded account of the same role. |
