# User guide

How to use the KISS Vocational Training Management Portal, one section per role. Every
screenshot is taken automatically from a freshly seeded copy of the app
(`pnpm --filter @vtmp/web docs:screens`), so it matches what you see.

- [Signing in, language and phones](#signing-in-language-and-phones)
- [Students](#students)
- [Trainers](#trainers)
- [Admins](#admins)
- [Employers and the public](#employers-and-the-public)
- [Help and problems](#help-and-problems)

---

## Signing in, language and phones

![Sign-in page](screenshots/public-login.jpg)

1. Open the portal and sign in with your email and password. After 5 wrong passwords the
   account locks for 15 minutes; the sign-in page then says "Wrong email or password, or the
   account is locked", the same as for a wrong password, so nobody can tell which emails exist.
2. You land on your role's dashboard. The sidebar lists everything you can do; every task is
   at most three clicks from the dashboard.
3. **Language:** choose English, ଓଡ଼ିଆ (Odia) or हिन्दी (Hindi) at the top. The choice is saved to
   your profile and follows you to other devices.
4. **Profile:** *My profile* in the menu at the top right holds your name, phone, an optional
   Odia name for your certificate, and the password change.
5. **Notifications:** the bell shows new messages (application decisions, certificates,
   support from your trainer).

The portal works on phones: on a small screen the sidebar opens from the menu button, and
lists show each row as a card instead of a wide table. Filters you choose on a list (for
example *Active* users or *Pending review* applications) are remembered on that device.

![Phone view](screenshots/phone-student-training.jpg)

---

## Students

### Dashboard

![Student dashboard](screenshots/student-dashboard.jpg)

Your application status, attendance, current aggregate and projected grade at a glance, and
**Download performance report** for a PDF of your results.

### Apply for a course

![Course catalogue](screenshots/student-courses.jpg)

1. On **Courses**, choose a **Training cycle** from the list (nothing is chosen for you; only
   cycles that offer courses and haven't ended are listed). Its courses appear, with seats and
   whether applications are open.
2. Open a course for details, then **Apply**. Rank up to three courses in order of
   preference.
3. **My enrollment** shows your application status (Pending, Approved, Waitlisted, Allocated,
   Rejected) and the reason if it was rejected. You can change preferences or withdraw while it
   is pending.

You can have one active application per training cycle, and only while the window is open.
Once you are approved, placed or training in one cycle, you can't apply for another cycle whose
dates overlap it.
Once you have applied, **Courses** marks each course you chose with **Applied · choice N** and
the application's status, with a link to your application instead of **Apply**.

### Follow your training

![My training](screenshots/student-training.jpg)

**My training** shows your attendance (you need at least 75 %), every assessment result, your
weighted aggregate and projected grade, your trainer's evaluation and your session history.
Figures update as soon as your trainer records them.

### Skill gaps and resources

![My skill gaps](screenshots/student-skills.jpg)

**My skill gaps** lists each competency of your course below the required level, largest gap
first, with resources and practice tasks your trainers have approved. Competencies not yet
assessed are listed separately.

### Skill Passport

![Skill Passport](screenshots/student-passport.jpg)

Every skill your trainers have **verified**, across all your courses, plus your certificates.

- **Download PDF** for a printable copy.
- **Share passport** creates a link (and QR code) for an employer. You choose how long it lasts
  and can revoke it at any time. The shared page shows only your name, verified skills and
  certificates: never marks, attendance or contact details.

### Opportunities

![Opportunities](screenshots/student-opportunities.jpg)

Internships, apprenticeships and jobs, ranked by how many of the required skills you have
verified (match %). Each one lists the skills you are missing, with resources to close the gap.
Press **I'm interested** to let the placement team know.

### Certificates

![My certificates](screenshots/student-certificates.jpg)

Once you complete a course you can download your certificate. Each certificate has a unique ID
and a QR code that anyone can scan to check it is genuine.

### Training assistant

The training assistant answers questions from your course notes. It is switched off on this
installation (it needs a paid AI service); the page says so.

---

## Trainers

### Dashboard and sessions

![Trainer dashboard](screenshots/trainer-dashboard.jpg)

Your batches, today's sessions and students who need attention.

![Sessions](screenshots/trainer-sessions.jpg)

**Sessions** lists your sessions by day. Open one to take attendance.

### Take attendance

![Attendance sheet](screenshots/trainer-attendance.jpg)

1. Press **Mark all present**, then change anyone who is late or absent.
2. **Save attendance.** You can change it for 48 hours; after that only an admin can, with a
   reason, and the change is logged. The 48 hours start when you first save, or when the
   session ends if you haven't saved by then: a session you never mark closes to you 48 hours
   after it ended, and the sheet says by when to mark it.

A student whose account was deactivated, or who was withdrawn from the training, is no longer
on new attendance sheets; sessions already marked keep their mark.

Mark every session once it has ended. A session that ended but was never marked shows in the
batch's **Attendance** tab under *Not marked*, and it holds up completion: the attendance
percentage counts only marked sessions, so it would otherwise look better than it is.

With a keyboard: Tab moves between students, the arrow keys choose Present / Late / Absent.

### Assessments and marks

![Assessments](screenshots/trainer-assessments.jpg)

1. **Add assessment**: title, type (theory or practical), maximum marks, weightage, mandatory or
   not. Its date must fall within the batch's dates.
2. **Enter marks** for each student (0 to the maximum; the form stops anything outside it).
3. For practical assessments, **Evidence** lets you attach photos, PDFs or video links and score
   them against a rubric.

### Competencies

![Competency ratings](screenshots/trainer-competencies.jpg)

Rate each student's level (1–4) on each competency of the course and **verify** it when you have
seen it demonstrated. Verified skills appear on the student's Skill Passport.

### At-risk students

![At-risk students](screenshots/trainer-at-risk.jpg)

Every night the portal checks attendance, marks and mandatory skills. Students below the
thresholds are flagged **Medium** or **High** with the reasons. Open a student to agree a
support action (remedial session, practice task, counselling) with an owner and due date, and
record the outcome. A flag closes by itself once the student has been clear for 7 days, or when
they finish training. A High flag still open after 14 days is escalated to the admins.

---

## Admins

### Dashboard

![Admin dashboard](screenshots/admin-dashboard.jpg)

Counts, completion rate, escalated students, the application funnel and grade charts.

### Users, courses and cycles

**Users** creates students, trainers and admins and deactivates accounts (sign-in stops at once).
**Reset password** sets a new password for someone who forgot theirs (share it with them
privately); it also unlocks a locked account and signs them out everywhere. **Unlock** clears a
lock straight away. When you add a user or reset a password, *Ask them to choose their own
password at first sign-in* is ticked: they then see only *Change password* until they do. A
trainer who is the only trainer of a planned or running batch can't be deactivated until
another trainer is assigned to it.
**Courses & cycles** manages courses, training cycles and the enrollment window of each course.
Untick *A person checks the prerequisites before approval* on a course whose prerequisites every
applicant meets (for example "Class 8 pass"), so automatic approval can approve it. Once a
course has batches in a cycle, students see seats left in those batches.

Both lists show only active records by default; pick *Inactive* or *All* in **Status** to see
the rest. To tidy up, tick several rows (or the box above the list to select all shown) and use
**Deactivate selected** or **Reactivate selected**. **Delete** removes a record for good, but only
one with no history, such as an account or course created by mistake. Anything that has been
used (applications, training records, decisions) keeps its row and can only be deactivated, so
no record ever loses its student, trainer or course.

### Enrollments and allocation

![Enrollments](screenshots/admin-enrollments.jpg)

1. **Enrollments → Automatic approval**: switch it on and set the rules (minimum CGPA; whether
   courses with prerequisites need your review). From then on every application that meets
   the rules is approved the moment the student submits it, and the student is told at once.
   **Approve eligible pending applications** applies the rules to what is already waiting.
2. **Enrollments**: the applications that don't meet the rules wait in the list with the reason
   ("CGPA 5.20 is below 6.00", "Electrician has prerequisites"). Approve, waitlist or reject
   them, one at a time or in bulk (rejection needs a reason the student sees). The latest
   applications are at the top.
3. **Batches → Run allocation**: preview the automatic allocation (by preference rank, then the
   tie-break rule in Settings), check the scheduling advice (capacity, clashes, free slots and
   trainers), then **Confirm allocation**. Nothing changes until you confirm.

![Batches](screenshots/admin-batches.jpg)

4. **A student leaves**: on the batch's **Students** tab press **Withdraw** and give a reason
   (the student sees it). Before the batch starts the seat is simply freed. Once training has
   started the student stays on the list as *Withdrawn*, with their attendance and marks so far,
   but leaves attendance sheets, mark entry and risk checks, and the seat is freed.
5. **Training is over**: the dashboard's *Training over: still open* card lists every running
   batch past its end date, with how many students still need a decision (a link to
   Completions) or *Ready to close*. Once every student has a decision on **Completions** (completed, not
   completed or withdrawn), press **Close batch** on the batch, from the day after its end
   date. A closed batch takes no more attendance, marks, sessions or students and leaves the
   lists of active batches; everything recorded stays readable.

### Completion and certificates

![Completions](screenshots/admin-completions.jpg)

**Completions** shows every student of a batch with the completion checks: attendance ≥ 75 %,
every session that has ended marked, all mandatory assessments, aggregate ≥ 40 % and the
trainer's recommendation. **Approve** issues
the certificate (PDF with ID and QR code); students who don't meet the rules can be marked *Not
completed* with a reason.

![Certificates](screenshots/admin-certificates.jpg)

**Certificates** lists every certificate issued. **Revoke** (with a reason) makes it show as
*Revoked* on the public check at once; the reason stays private. **Reissue** gives a new
certificate ID with the same grade and figures: the old ID then shows as *Superseded*, or stays
*Revoked* if it was revoked (so a certificate revoked by mistake or to correct it can be replaced).

Approving applications is refused for a student who is already approved, placed or training in
another cycle whose dates overlap; the message names the other cycle.

### At-risk students, opportunities, reports and analytics

![At-risk students (admin)](screenshots/admin-at-risk.jpg)

Admins see every batch's flags and can **Run the check now**.

![Opportunities admin](screenshots/admin-opportunities.jpg)

**Opportunities** publishes internships, apprenticeships and jobs for job roles (the
competencies and levels each role needs), and lists interested students with their match %.

![Reports](screenshots/admin-reports.jpg)

**Reports** downloads a batch report (attendance, marks, aggregate, grade, completion status and
certificate per student) or a course report (completion rate and grades), as CSV or PDF, and a
performance report for any student.

![Outcome analytics](screenshots/admin-analytics.jpg)

**Outcome analytics** compares completion, average score, attendance, verified skills and
placements across courses and batches, and records placements (job, apprenticeship,
internship, self-employment or further study) for students who finished. Figures are rebuilt
nightly; **Refresh now** includes today's changes.

### Audit log

![Audit log](screenshots/admin-audit.jpg)

Every change (applications, attendance, marks, completion, certificates, ratings, flags) with
who, what, before and after, and when. Filter and export as CSV. Entries can never be edited or
deleted, not even by an admin.

---

## Employers and the public

![Certificate verification](screenshots/public-verify.jpg)

Scan the QR code on a certificate, or open `/verify` and type its ID. The page shows only the
holder's name, the course, grade, issue date and whether it is **Valid** or **Revoked**. A
student's shared Skill Passport link works the same way: no sign-in needed, nothing private
shown.

---

## Help and problems

| Problem | What to do |
| --- | --- |
| Forgot password | Ask an admin: **Users → Reset password** sets a new one. |
| "Wrong email or password, or the account is locked" | Check the email and password. After 5 wrong tries the account is locked for 15 minutes: wait, or ask an admin to **Unlock** it. |
| New password refused | Use at least 8 characters with at least one letter and one digit. |
| Can't edit attendance | The 48-hour window has passed: ask an admin to correct it. |
| Not eligible to complete | The Completions page shows which rule fails (attendance, sessions not marked yet, missing assessment by name, aggregate, recommendation). |
| "The batch must run within its training cycle's dates" | Batches start and end inside their cycle. Change the batch dates, or the cycle's first (a cycle can't be shortened past its batches or open application windows). |
| "Applications must close by the end of the training cycle" | Set the window to close on or before the cycle's last day. |
| *Close batch* is greyed out | The end date hasn't passed yet, or the dialog lists students who still need a decision on **Completions**. |
| Sent to *Change password* at sign-in | The training office set your password: type it as the current password and choose your own. |
| A shared passport link stopped working | It expired or the student revoked it: ask for a new link. |
| Wrong language | Use the language menu at the top; it is remembered on your profile. |
