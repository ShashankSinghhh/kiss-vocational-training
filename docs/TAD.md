# KISS Vocational Training Management Portal --- Technical Architecture Document

Oct 9, 2026 (v1.0) · updated Nov 1, 2026 (v1.2) · \@Shashank Singh

## 1. Document control and purpose

This TAD (v1.2, updated after release) describes how the portal is built to meet the
BRD: one modular monolith on React, Node.js / Express and PostgreSQL,
extended with competency, risk, passport, verification and AI modules.

  -----------------------------------------------------------------------
  Item                                Detail
  ----------------------------------- -----------------------------------
  Document                            Technical Architecture Document
                                      (TAD)

  Version                             1.2 --- Amendment 1 (hosting),
                                      Amendment 2 (post-release changes)
                                      and Amendment 3 (automation)

  Inputs                              KISS VTMP BRD v1.2; Project
                                      Documentation v2.1 (Sections 9--13,
                                      23)

  Audience                            Development team (2 members),
                                      project guide, examiners

  Scope                               Releases R1 (core F1--F9), R2 (F10,
                                      F11, F12, F15) and R3 (F13, F14,
                                      F16--F20)
  -----------------------------------------------------------------------

Where this TAD and v2.1 differ, this TAD wins for architecture; the BRD
wins for business rules.

> **Amendment 1 (2026-10-19): hosting is Vercel + Neon only.** The API
> no longer runs on Render/Railway: Render requires a card, and the
> team's card was declined. One Vercel project (Hobby, function region
> sin1) serves the React SPA and runs the unchanged Express app as a
> serverless function on the same origin. PostgreSQL 16 is on Neon
> (Singapore). Locally and in CI the API still runs as a normal server.
> Effects on this document:
>
> - Scheduling (ADR-07, §8.2) uses Vercel Cron in production, with
>   node-cron only for local runs.
> - Security rate limits share counts in a Postgres table, because
>   serverless instances share no memory.
> - Files go to a private Vercel Blob store (chosen in Sprint 6),
>   because functions have no persistent disk.
> - The free-tier risks in §15.1 change accordingly.
>
> Rows changed by this amendment are marked "(Amendment 1)". Setup and
> the reasons for each choice are in docs/internal/DEPLOYMENT.md and
> docs/internal/PROGRESS.md (Sprint 2).

> **Amendment 2 (2026-11-01): changes after release.** After Release 3
> the team used the portal and reviewed it twice (a site test run and a
> logic review; see internal/PROGRESS.md). The architecture is unchanged: the same
> modules, layers and rules apply. What changed:
>
> - **Business rules:** BR-06, BR-09, BR-19 and BR-20 were amended and
>   BR-23 to BR-28 added (BRD v1.1, Section 10). Each lives in a service
>   or a pure rule function with boundary tests, as before.
> - **Endpoints:** 11 new admin routes (Section 7), all behind the same
>   pipeline; the route table grew from 156 to 167.
> - **Data:** one migration adds User.must_change_password and
>   Course.prerequisites_need_review (Section 6.1). Batch.status CLOSED
>   and Enrollment.status WITHDRAWN existed but were never set; they are
>   now (Section 8.4).
> - **Settings:** enrollment.autoApprove, enrollment.autoApproveManualIfPrerequisites
>   and enrollment.autoApproveManualIfPrerequisites (automatic approval).
> - **Security:** the global rate limit counts signed-in users one by one
>   instead of per address; admin-set passwords must be changed before
>   anything else (Section 9).
>
> Rows changed by this amendment are marked "(Amendment 2)".

> **Amendment 3 (2026-11-01): automation.** The nine steps the logic
> review found done by hand (BRD v1.2, Section 8.2) are automated
> without new infrastructure:
>
> - **One new module, `automation`**, in the innovation tier: it calls
>   exported services of core and innovation modules, and no core module
>   imports it (the module-boundary test lists it).
> - **One nightly job**, `/internal/jobs/daily-automation` (Vercel Cron at
>   21:30 UTC, 03:00 IST; node-cron locally), under the same job lease as
>   the others. Its steps run in order and independently: automatic
>   approval of waiting applications, waitlist promotion, closing finished
>   batches, reminders, notices, placement follow-ups. Notices that fire
>   once cover the time since the last successful run.
> - **At the moment they apply:** waitlist promotion after a seat frees
>   up (batches service), a session-cancelled notice (batches), a match
>   notice when an opportunity is published (opportunities), and an
>   analytics refresh after a certificate (completion announces
>   certificateEvents.issued on the core event bus; automation subscribes).
> - **11 new Settings** (`automation.*`, `analytics.autoRefreshMinutes`),
>   changed on the admin's Automation page (GET/PUT /admin/automation,
>   POST /admin/automation/run). Notices are in-app only: email or SMS
>   would need a paid service.
> - **CSV import** of students: POST /admin/users/import, checked row by
>   row, all or nothing, in one transaction.
>
> Rows changed by this amendment are marked "(Amendment 3)".

## 2. Architecture overview

The portal is a modular monolith: one React frontend, one Express API
and one PostgreSQL database, with business rules held in a service layer
split by module.

layered architecture · 6 layers

Requests flow top to bottom; nothing reaches the service layer without
passing authentication, role, ownership and validation checks. The daily
job and the AI provider are the only parts outside the request path.

## 3. Architecture principles and key decisions

The design favours one simple deployable app with strict module
boundaries, because two developers must build, test and demo it in 12
weeks.

**Principles**

1.  Business rules live in the service layer, never in controllers or
    the UI.

2.  Authorization is enforced on the server for every request (role +
    ownership).

3.  Every status change runs in a database transaction and writes an
    audit entry.

4.  Thresholds (75%, 40%, 48 h, risk levels) are configuration rows, not
    constants.

5.  Innovation modules read core data; core modules never depend on
    innovation modules.

6.  Public endpoints expose the minimum data and are rate-limited.

**Architecture decision records**

  ----------------------------------------------------------------------------
  ADR               Decision              Alternatives      Rationale
                                          considered        
  ----------------- --------------------- ----------------- ------------------
  ADR-01            Modular monolith      Microservices     One deploy, one
                                                            DB, simple
                                                            testing; modules
                                                            still separable
                                                            later

  ADR-02            PostgreSQL            MySQL, MongoDB    Strong
                                                            constraints,
                                                            transactions,
                                                            JSONB for rubric
                                                            data, pgvector for
                                                            F17

  ADR-03            Prisma ORM with       Sequelize, raw    Type-safe queries,
                    migrations            SQL               versioned schema
                                                            shared by both
                                                            members

  ADR-04            REST + JSON, OpenAPI  GraphQL           Simple, easy to
                    contract                                test with
                                                            Supertest and
                                                            Postman

  ADR-05            JWT access token (15  Server sessions   Stateless API;
                    min) + refresh token                    refresh cookie
                    in httpOnly cookie                      limits token theft
                                                            via XSS

  ADR-06            Server-side PDF       Client-side PDF   Tamper-resistant
                    generation (PDFKit)                     documents; one
                    with QR (qrcode)                        template

  ADR-07            Scheduled job for     Separate worker,  Daily batch volume
                    risk flags: Vercel    message queue     is small; no extra
                    Cron in production,                     infrastructure
                    node-cron locally
                    (Amendment 1)

  ADR-08            i18next with JSON     Hard-coded        Odia and Hindi
                    resource files (en,   strings           added without code
                    or, hi)                                 change (NFR-11)

  ADR-09            Retrieval-augmented   Open-ended        Grounded answers
                    AI over approved      chatbot           with citations;
                    materials only,                         can be switched
                    behind a feature flag                   off (BR-21)

  ADR-10            Object storage for    Files in DB       Keeps DB small;
                    evidence files; DB                      signed URLs
                    stores metadata only                    control access
  ----------------------------------------------------------------------------

## 4. Technology stack

The stack is the v2.1 choice plus five libraries for the unique
features; all are free and open source except the optional AI API.

  -----------------------------------------------------------------------
  Layer                   Technology              Used for
  ----------------------- ----------------------- -----------------------
  Frontend                React 18, Vite, React   Role-based SPA,
                          Router, Tailwind CSS    responsive layouts

  Frontend data           TanStack Query, React   Caching, forms with
                          Hook Form + Zod         shared validation

  Charts                  Recharts                Dashboards, gap
                                                  heatmap, analytics (F9,
                                                  F12, F20)

  Localization            i18next, react-i18next, English, Odia, Hindi
                          Noto Sans Oriya /       (F16)
                          Devanagari fonts        

  API                     Node.js 20 LTS,         REST endpoints,
                          Express, Zod            validation

  Auth                    jsonwebtoken, bcrypt,   Login, RBAC, security
                          helmet,                 headers, throttling
                          express-rate-limit,     
                          cors                    

  Data access             Prisma ORM              Schema, migrations,
                                                  transactions

  Database                PostgreSQL 16 (+        Relational store;
                          pgvector extension for  embeddings for F17
                          R3)                     

  Documents               PDFKit, qrcode          Certificates, reports,
                                                  QR codes (F7, F15)

  Scheduling              Vercel Cron (prod),     Daily risk evaluation,
                          node-cron (local)       flag escalation (F11)
                          (Amendment 1)

  File storage            Private Vercel Blob     Evidence uploads (F18),
                          store (chosen in        stored PDFs
                          Sprint 6; local disk
                          in development)
                          (Amendment 1)

  AI (R3, optional)       Claude API              AI Training Assistant
                          (claude-haiku-5-5 for   (F17)
                          cost), embeddings from  
                          an open-source model    
                          (e.g. bge-m3, 1024      
                          dimensions) stored in   
                          pgvector                

  Testing                 Jest, Supertest,        Unit, API, end-to-end
                          Playwright              

  Tooling                 GitHub, GitHub Actions, Version control, CI,
                          ESLint, Prettier        code quality

  Hosting                 Vercel (frontend + API  Free-tier deployment,
                          as a serverless         no card required
                          function, region sin1),
                          Neon (PostgreSQL 16,
                          Singapore)
                          (Amendment 1)
  -----------------------------------------------------------------------

## 5. Module design

The backend has 12 core modules (auth, audit and settings form a shared
kernel) and 9 innovation modules; each module owns its routes,
controller, service, validation schema and tests.

module dependency map · 9 core, 9 innovation

Because dependencies run one way, any innovation module can be switched
off or cut from scope without breaking the core workflow.

  -----------------------------------------------------------------------------------------------
  Module                   Responsibility   Owns tables             Release        Owner
  ------------------------ ---------------- ----------------------- -------------- --------------
  auth                     Login, refresh,  User, RefreshToken      R1             P1
                           logout, password
                           change, RBAC +
                           ownership
                           middleware;
                           forced change of
                           admin-set
                           passwords, one
                           answer for every
                           failed sign-in
                           (BR-27,
                           Amendment 2)

  students / trainers      Profiles and     Student, Trainer        R1             P2
                           master data;
                           admin reset,
                           unlock, bulk
                           status, safe
                           delete; a needed
                           trainer stays
                           active (BRQ-1.4,
                           BRQ-2.5, BR-28,
                           Amendment 2)

  courses                  Courses,         Course                  R1             P2
                           enrollment
                           windows,
                           prerequisites;
                           cycle choice for
                           students, bulk
                           status, safe
                           delete, windows
                           inside the cycle
                           (BRQ-2.4,
                           BRQ-2.5, BR-24,
                           Amendment 2)

  enrollments              Ranked           Enrollment              R1             P1 / P2
                           preferences,
                           review, waitlist
                           (BR-01, BR-02);
                           automatic
                           approval, no
                           overlapping
                           trainings
                           (BRQ-3.5, BR-23,
                           Amendment 2)

  batches + allocation     Batches,         Batch, BatchStudent,    R1             P2
                           allocation       TrainerAssignment
                           preview and
                           confirm (BR-03,
                           BR-04); dates
                           inside the
                           cycle, withdraw,
                           close
                           (BR-24--BR-26,
                           Amendment 2)

  sessions + attendance    Scheduling,      TrainingSession,        R1             P1
                           attendance, 48 h Attendance
                           edit window from
                           the first
                           marking or the
                           session's end;
                           unmarked
                           sessions counted
                           (BR-05, BR-06,
                           BR-08, Amendment
                           2)

  assessments              Assessments,     Assessment,             R1             P1
                           results,         AssessmentResult,                      
                           progress,        Progress, Evaluation                   
                           evaluations                                             
                           (BR-07, BR-11)                                          

  completion               Eligibility      --- (reads others;      R1             P2
                           engine (BR-09,   writes Enrollment
                           incl. sessions   status)
                           recorded,
                           Amendment 2),
                           completion queue

  documents                Certificate and  Certificate,            R1 / R2        P2
                           report PDFs, QR  PerformanceReport                      
                           codes                                                   

  reports + dashboard      Aggregates, CSV  Read-only views         R1             P2
                           / PDF export;
                           ended batches
                           awaiting
                           decisions
                           (BRQ-4.6,
                           Amendment 2)

  audit                    Append-only      AuditLog                R1 / R3        P2
                           change log,                                             
                           viewer                                                  

  settings                 Configurable     Setting                 R1             P2
                           thresholds                                              

  **competency**           Competency       Competency,             R2             P1
                           model, ratings,  AssessmentCompetency,                  
                           gap calculation  CompetencyRating,                      
                           (F12)            LearningResource                       

  **passport**             Skill Passport   PassportShare           R2             P1
                           view, share                                             
                           tokens (F10)                                            

  **intervention**         Daily risk       RiskFlag,               R2             P1
                           evaluation,      InterventionAction                     
                           flags, actions,                                         
                           escalation (F11)                                        

  **verification**         Public           --- (reads Certificate, R2             P2
                           certificate and  PassportShare)                         
                           passport lookup                                         
                           (F15)                                                   

  **opportunities**        Job roles,       JobRole, Opportunity,   R3             P2
                           opportunities,   OpportunityInterest                    
                           matching (F13)                                          

  **scheduling-advisor**   Capacity and     --- (reads batches,     R3             P2
                           clash detection, sessions)                              
                           suggestions                                             
                           (F14)                                                   

  **evidence**             Uploads and      PracticalEvidence,      R3             P1
                           rubric scores    Rubric                                 
                           (F18)                                                   

  **assistant**            Retrieval and    Material,               R3             P1
                           answer           MaterialChunk,                         
                           generation (F17) AssistantLog                           

  **analytics**            Outcome          Read-only materialized  R3             P2
                           analytics (F20)  views                                  

  **automation**           Nightly jobs,    --- (Settings rows;     v1.2           P1 / P2
                           reminders and    calls other modules'
                           notices,         services)
                           waitlist
                           promotion,
                           auto-close,
                           analytics
                           refresh after
                           certificates
                           (BRQ-3.6--20.5,
                           Amendment 3)
  -----------------------------------------------------------------------------------------------

Modules call each other only through exported service functions, never
another module\'s tables directly. Innovation modules (bold) may read
core services; core modules never import them.

## 6. Data architecture

One PostgreSQL database in 3NF holds the 17 v2.1 entities plus 18 new
tables; integrity is enforced with keys, unique constraints and check
constraints, not only in code.

### 6.1 Core entities (from v2.1, unchanged)

User, Student, Trainer, Course, Enrollment, Batch, BatchStudent,
TrainerAssignment, TrainingSession, Attendance, Progress, Assessment,
AssessmentResult, Evaluation, Certificate, PerformanceReport, AuditLog.

Additions to existing tables: Certificate.status (VALID, REVOKED,
SUPERSEDED), Certificate.public_code (12+ char random, unique),
Certificate.revoked_reason, Certificate.verification_count;
Assessment.mode (THEORY, PRACTICAL); User.locale (en, or, hi).

Added by Amendment 2 (migration
20261028100000_password_change_and_prerequisite_review):
User.must_change_password (set when an admin chooses the password,
cleared when the user changes it) and Course.prerequisites_need_review
(default true; when false, automatic approval does not hold
applications for that course's prerequisites).

### 6.2 New tables

  -----------------------------------------------------------------------------
  Table                  Key columns        Constraints       Release
  ---------------------- ------------------ ----------------- -----------------
  Setting                key (PK), value,   Typed values      R1
                         updated_by,        validated by Zod  
                         updated_at                           

  RefreshToken           token_id (PK),     Hash only, never  R1
                         user_id (FK),      raw token         
                         hash, expires_at,                    
                         revoked_at                           

  Competency             competency_id      unique            R2
                         (PK), course_id    (course_id,       
                         (FK), code, title, code);            
                         mode,              required_level    
                         required_level,    1--4              
                         is_mandatory                         

  AssessmentCompetency   assessment_id      PK                R2
                         (FK),              (assessment_id,   
                         competency_id (FK) competency_id)    

  CompetencyRating       rating_id (PK),    level 1--4;       R2
                         student_id,        unique (student,  
                         competency_id,     competency,       
                         batch_id, level,   batch)            
                         rated_by,                            
                         verified_at                          

  LearningResource       resource_id (PK),  url required      R2
                         competency_id                        
                         (FK), title, type,                   
                         url, approved_by                     

  PassportShare          share_id (PK),     unique token_hash R2
                         student_id (FK),                     
                         token_hash,                          
                         expires_at,                          
                         revoked_at                           

  RiskFlag               flag_id (PK),      one open flag per R2
                         student_id,        (student, batch)  
                         batch_id, level,   via partial       
                         reasons (JSONB),   unique index      
                         opened_at,                           
                         closed_at,                           
                         escalated_at                         

  InterventionAction     action_id (PK),    due_on ≥ created  R2
                         flag_id (FK),      date              
                         type, owner_id,                      
                         due_on, outcome,                     
                         completed_at                         

  JobRole,               role_id, title;    composite PK      R3
  JobRoleCompetency      (role_id,                            
                         competency_code,                     
                         level)                               

  Opportunity,           opportunity_id,    composite PK on   R3
  OpportunityInterest    role_id, type,     interest          
                         partner,                             
                         closes_on;                           
                         (opportunity_id,                     
                         student_id)                          

  Rubric,                rubric criteria    size ≤ 10 MB;     R3
  PracticalEvidence      (JSONB);           allowed mime list 
                         evidence_id,                         
                         result_id,                           
                         object_key, mime,                    
                         size_bytes, scores                   
                         (JSONB)                              

  Material,              material_id,       approved_by NOT   R3
  MaterialChunk,         course_id,         NULL              
  AssistantLog           approved_by; chunk                   
                         text + embedding                     
                         vector(1024);                        
                         question, sources,                   
                         tokens                               
  -----------------------------------------------------------------------------

### 6.3 Data rules in the database

-   AuditLog is insert-only: the app\'s DB role has no UPDATE or DELETE
    on it.

-   Check constraints enforce BR-07 (0 ≤ marks ≤ max_marks) and level
    ranges.

-   Partial unique index enforces BR-01: one active enrollment per
    student per cycle.

-   Derived values (attendance %, aggregate, gap, match %) are computed
    on read or in SQL views, not stored, except snapshots on
    PerformanceReport and Certificate.

-   A student withdrawn from a running batch keeps their BatchStudent
    row, so attendance and marks stay linked; seat counts, sheets, mark
    entry and risk checks leave out WITHDRAWN enrollments (Amendment 2).

-   Unmarked sessions are counted on read: SCHEDULED sessions that ended
    after the student was placed (BatchStudent.allocated_at), never
    stored (Amendment 2).

## 7. API design

All endpoints sit under /api/v1, return JSON and share one error format;
the v2.1 endpoint list (Section 23) stays, and the table below adds the
unique-feature endpoints.

**Conventions**

-   Error body: { \"error\": { \"code\": \"ENROLLMENT_WINDOW_CLOSED\",
    \"message\": \"...\" } } with HTTP 400, 401, 403, 404, 409 or 422.

-   Pagination: ?page=&pageSize= (max 100); filtering by query
    parameters.

-   Every mutating request validated by a Zod schema shared with the
    frontend.

-   Idempotent actions (approve, allocate confirm, issue certificate)
    accept an Idempotency-Key header.

-   Contract kept in openapi.yaml; Postman collection generated from it.

**New endpoints**

  ---------------------------------------------------------------------------------------
  Method & path                     Purpose           Role              Feature
  --------------------------------- ----------------- ----------------- -----------------
  GET/POST/PUT                      Manage course     Admin             F12
  /courses/:id/competencies         competencies                        

  PUT                               Rate students on  Trainer (own      F10, F12
  /batches/:id/competency-ratings   competencies      batch)            

  GET /students/:id/passport        View Skill        Student (own),    F10
                                    Passport          Trainer, Admin    

  POST /students/me/passport/shares Create or revoke  Student           F10
  · DELETE /passport/shares/:id     share link                          

  GET /students/:id/gaps · GET      Gap report, batch Student (own),    F12
  /batches/:id/competency-heatmap   heatmap           Trainer, Admin    

  GET /risk-flags?batchId=&level=   At-risk list      Trainer (own),    F11
                                                      Admin             

  POST /risk-flags/:id/actions ·    Record or update  Trainer, Admin    F11
  PATCH /risk-actions/:id           remedial action                     

  POST /certificates/:id/revoke     Revoke            Admin             F15
                                    certificate                         

  GET /public/verify/:code          Verify            Public            F15
                                    certificate (no                     
                                    login)                              

  GET /public/passport/:token       View shared       Public            F10
                                    passport (no                        
                                    login)                              

  GET/POST /opportunities · GET     Publish           Admin / Student   F13
  /students/me/matches              opportunities,                      
                                    see matches                         

  POST /scheduling/check            Detect capacity   Admin             F14
                                    and clash                           
                                    conflicts                           

  POST /evidence/upload-url · POST  Get signed upload Trainer           F18
  /results/:id/evidence             URL, attach                         
                                    evidence                            

  POST /assistant/ask               Ask the AI        Student           F17
                                    assistant                           

  GET /analytics/outcomes           Outcome analytics Admin             F20

  GET/PUT /settings                 Read or change    Admin             All
                                    thresholds                          
  ---------------------------------------------------------------------------------------

**Endpoints added after release (Amendment 2)**

GET /cycles (students' cycle choice, BRQ-2.4) also gained an
applications field per cycle. All new routes are admin-only and
idempotent where they change state.

  ----------------------------------------------------------------------------------------------------
  Method & path                                        Purpose                  Role   Requirement
  ---------------------------------------------------- ------------------------ ------ ---------------
  POST /admin/users/:id/password                       Reset a forgotten        Admin  BRQ-1.4, BR-27
                                                       password (asks for a new
                                                       one at next sign-in)

  POST /admin/users/:id/unlock                         Clear a login lock       Admin  BRQ-1.4

  POST /admin/users/bulk-status · DELETE               Deactivate or reactivate Admin  BRQ-2.5, BR-28
  /admin/users/:id                                     in bulk; delete an
                                                       unused account

  POST /admin/courses/bulk-status · DELETE             Deactivate or reactivate Admin  BRQ-2.5
  /admin/courses/:id                                   in bulk; delete an
                                                       unused course

  GET/PUT /admin/enrollments/auto-approval · POST      Read or change the       Admin  BRQ-3.5
  /admin/enrollments/auto-approve                      rules; apply them to
                                                       pending applications

  POST                                                 Withdraw a student with  Admin  BRQ-4.5, BR-26
  /admin/batches/:id/students/:enrollmentId/withdraw   a reason

  POST /admin/batches/:id/close                        Close a finished batch   Admin  BRQ-4.6, BR-25

  GET/PUT /admin/automation · POST                     Automation settings,     Admin  BRQ-4.7,
  /admin/automation/run                                last run, Run now               BRQ-9.5
                                                       (Amendment 3)

  POST /admin/users/import                             CSV import of students,  Admin  BRQ-1.5
                                                       dry run first (Amendment
                                                       3)
  ----------------------------------------------------------------------------------------------------

## 8. Key runtime flows

Three flows carry most of the new logic; each runs inside one
transaction and ends with an audit entry.

### 8.1 Completion approval to certificate with QR (F7, F15)

1.  Admin calls POST /completions/:studentId/approve with an
    Idempotency-Key.

2.  Auth middleware checks role = Admin.

3.  Completion service recomputes eligibility (BR-09) from Attendance,
    AssessmentResult and Evaluation; if not eligible → 409, nothing
    saved.

4.  In one transaction: Enrollment → Completed; Certificate row created
    with a 12-character random public_code (crypto.randomBytes, base32);
    AuditLog entries written.

5.  After commit, documents service renders the PDF with PDFKit, embeds
    a QR of https://\<base-url\>/verify/\<public_code\>, uploads to
    storage and sets Enrollment → Certified.

6.  If PDF rendering fails, status stays Completed and Admin can retry
    (v2.1 UC-04 4a).

### 8.2 Daily risk evaluation job (F11, F12)

1.  A daily scheduled job (Vercel Cron in production, calling a
    secret-protected API route; node-cron at 02:00 locally) starts the
    run; a DB advisory lock stops two runs at once (Amendment 1). On
    the Hobby plan the cron fires once a day, possibly up to an hour
    late, which suits a daily job.

2.  For each student in an Active batch, one SQL query computes
    attendance %, consecutive absences, latest and previous assessment
    %, projected aggregate and mandatory competency gaps.

3.  The intervention service applies BR-16 thresholds from Setting and
    derives Low / Medium / High.

4.  Opens a RiskFlag if none is open, updates level and reasons if one
    is, closes it after 7 clear days (BR-17).

5.  Escalates High flags open longer than 14 days and creates an in-app
    notification for Admin.

6.  The same evaluation also runs on demand after attendance or marks
    are saved for that batch, so flags appear within one day at most.

### 8.3 Public certificate verification (F15)

1.  Employer scans the QR; browser opens /verify/\<code\> (a lightweight
    public page, no login).

2.  Page calls GET /public/verify/:code; rate limiter allows 30 requests
    per minute per IP.

3.  Verification service looks up the code; returns only name, course,
    grade, issue date and status, or 404.

4.  verification_count increments asynchronously; response is cacheable
    for 5 minutes (except after revocation, which purges the cache key).

### 8.4 Batch lifecycle: withdraw and close (F4, Amendment 2)

1.  A batch is created PLANNED, inside its cycle's dates (BR-24), and
    becomes ACTIVE on activation, which needs a trainer.

2.  A student who leaves is withdrawn with a reason: from a PLANNED
    batch the BatchStudent row is deleted; from an ACTIVE batch it stays
    and the enrollment becomes WITHDRAWN (BR-26). One transaction writes
    the status, the audit rows and the student's notification.

3.  From the day after the end date (institution calendar), the admin
    dashboard lists the batch with the students still undecided (BRQ-4.6).

4.  When no student is ALLOCATED or ACTIVE, POST /admin/batches/:id/close
    locks the batch row, checks closeBlocker (pure rule) and sets CLOSED
    with an audit row (BR-25); otherwise 409 names what is missing.

5.  A CLOSED batch refuses attendance, marks, sessions and students; its
    records stay readable.

### 8.5 Automatic approval (F3, Amendment 2)

1.  On submit or edit, the enrollments service screens the application
    with the pure rule screen() against Settings: the
    course's prerequisites_need_review flag and BR-23 (no overlapping
    training).

2.  If nothing holds it, it is approved in the student's own
    transaction, audited with by: AUTO_APPROVAL, and the student is
    notified; otherwise it stays PENDING with the reasons shown to the
    admin.

3.  POST /admin/enrollments/auto-approve applies the saved rules to a
    cycle's pending applications in one set-based UPDATE ... RETURNING,
    with bulk audit rows and notifications; a concurrent manual decision
    wins.

### 8.6 Daily automation run (Amendment 3)

1.  Vercel Cron calls /internal/jobs/daily-automation with the cron
    secret (node-cron at 03:00 IST locally; Run now from the Automation
    page). withJobLease claims the daily-automation lease, so two runs
    never overlap, and hands over the last successful run's time.

2.  Each step reads its switch and limits from Settings and runs in its
    own try/catch: one failing step is reported and the others still run.

3.  Steps, in order: automatic approval of waiting applications (when it
    is on); waitlist promotion into planned batches and running ones in
    their first days; closing batches ready for it (closeBlocker, BR-25)
    after the grace days; reminders to trainers (sessions inside the edit
    window still unmarked) and admins (old applications, ended batches
    with undecided students); notices to students (windows opened and
    passport links nearing expiry since the last success); placement
    follow-ups.

4.  Scheduled steps act as the system ({ userId: null }) in audit rows;
    notifications are in-app. The result (each step with enabled, count,
    error) is stored on the lease row and shown on the Automation page.

## 9. Security architecture

Every request passes the same middleware chain; public endpoints are a
separate router with its own limits and a minimal response shape.

**Request pipeline:** helmet (security headers) → CORS allow-list → rate
limiter → authenticate (verify JWT) → authorize(roles) →
requireOwnership(resolver) → Zod validation → controller → service.

  -----------------------------------------------------------------------
  Concern                             Design
  ----------------------------------- -----------------------------------
  Passwords                           bcrypt, cost 12; minimum 8
                                      characters with a letter and a
                                      digit; one generic error for every
                                      failed login, locked accounts
                                      included; a password set by an
                                      admin must be changed before
                                      anything else (BR-27, Amendment 2)

  Tokens                              Access JWT 15 min in memory;
                                      refresh token 7 days in httpOnly,
                                      Secure, SameSite=Strict cookie,
                                      rotated on use, stored as a hash

  Brute force                         5 failed logins per account per 15
                                      min → temporary lock, which an
                                      admin can clear; per-IP limit on
                                      /auth; the global limit counts
                                      signed-in users one by one, others
                                      per IP (Amendment 2)

  Ownership                           Resolvers check the trainer is
                                      assigned to the batch (BR-05) and
                                      that students read only their own
                                      records; violations return 403

  Input                               Zod on every body and query; Prisma
                                      parameterized queries; React
                                      escaping; no
                                      dangerouslySetInnerHTML

  Public endpoints                    /public/\* router: no auth, 30
                                      req/min/IP, fields whitelisted
                                      (BR-15), random non-sequential
                                      codes and tokens

  Share tokens                        32-byte random, stored hashed,
                                      expiry and revocation checked on
                                      every view

  File uploads                        Pre-signed URLs, 10 MB limit, MIME
                                      allow-list, private bucket;
                                      downloads through short-lived
                                      signed URLs

  AI assistant                        No student personal data in
                                      prompts; per-user daily question
                                      limit; prompt includes only
                                      retrieved approved text

  Secrets                             .env locally, platform secret store
                                      in production; never committed

  Transport                           HTTPS only (platform TLS); HSTS via
                                      helmet
  -----------------------------------------------------------------------

Security tests (v2.1 TC-08, TC-15 plus new ones) cover role escalation,
other users\' records, expired tokens, revoked share links and public
field leakage.

## 10. AI assistant architecture (F17, Release 3)

The assistant is retrieval-augmented: it answers only from course
materials an Admin has approved, cites them, and declines anything else
(BR-21).

**Ingestion (Admin uploads a material)**

1.  Admin uploads a PDF or text file for a course and approves it.

2.  Text is extracted and split into \~500-token chunks with 50-token
    overlap.

3.  Each chunk is embedded and stored in MaterialChunk.embedding
    (pgvector, cosine index).

**Answering (POST /assistant/ask)**

1.  Check the feature flag, the student\'s daily limit and the monthly
    cost cap.

2.  Embed the question; fetch the top 5 chunks for the student\'s own
    course(s).

3.  If the best similarity is below the threshold (e.g. 0.75), return a
    polite refusal with no model call.

4.  Otherwise call the Claude API (claude-haiku-5-5) with a fixed system
    prompt: answer only from the given excerpts, cite them, reply in the
    student\'s locale, refuse off-topic requests.

5.  Return the answer with source titles; log question, chunk IDs, token
    counts and latency to AssistantLog.

**Other modes:** practice questions (prompt seeded with a competency\'s
chunks, returns MCQs as JSON validated by Zod); simpler explanation
(same retrieval, \"explain at a beginner level\" instruction); resource
recommendations come from LearningResource rows linked to F12 gaps, not
from the model.

The module sits behind an interface (AssistantProvider) so a mock
provider runs in tests and the feature can be disabled without touching
other modules.

## 11. Deployment architecture

The prototype runs on two free-tier services (Amendment 1): Vercel,
which serves the SPA and runs the API as a serverless function on the
same origin, and Neon for managed PostgreSQL. Files (certificate PDFs,
later evidence) live in a private Vercel Blob store attached to the same
project (Sprint 6), and the AI API is called only when F17 is enabled.
Migrations run in the Vercel production build before new code goes
live.

deployment · 6 nodes

  -----------------------------------------------------------------------
  Environment       Purpose           Database          Deploys from
  ----------------- ----------------- ----------------- -----------------
  Local             Development       PostgreSQL in     Developer machine
                                      Docker, seeded    

  Test (CI)         Automated tests   PostgreSQL        Every pull
                                      service           request
                                      container, reset  
                                      per run           

  Production / demo Guide review and  Managed           main branch
                    final demo        PostgreSQL with   
                                      daily backup      
  -----------------------------------------------------------------------

Configuration comes only from environment variables: DATABASE_URL,
JWT_SECRET, REFRESH_SECRET, PUBLIC_BASE_URL, STORAGE\_\*, AI_ENABLED,
ANTHROPIC_API_KEY, AI_MONTHLY_CAP, plus DIRECT_DATABASE_URL (migrations),
TRUST_PROXY_HOPS and RATE_LIMIT_STORE for serverless hosting, and
BLOB_READ_WRITE_TOKEN with STORAGE_DRIVER=vercel-blob for file storage
(Amendment 1).

## 12. Non-functional design

Each BRD non-functional requirement maps to a concrete design choice and
a way to check it.

  -----------------------------------------------------------------------
  NFR                     Design choice           How verified
  ----------------------- ----------------------- -----------------------
  NFR-03 Performance (2   Indexes on all FKs and  k6 load test, 100
  s, 100 users)           filter columns;         virtual users
                          aggregates in SQL;      
                          TanStack Query caching; 
                          pagination              

  BO-3 Allocation (500    Single sorted in-memory Jest timing test with
  students \< 5 s)        pass, O(n log n + n·p); 500 seeded students
                          one bulk insert in a    
                          transaction             

  NFR-05 Reliability      prisma.\$transaction    Integration tests that
                          for status changes;     force a failure
                          idempotency keys; PDF   mid-operation
                          generation retried      
                          outside the transaction 

  NFR-09 Public pages (3  Separate lightweight    Lighthouse on throttled
  s mobile)               verify page (no SPA     mobile
                          bundle), cache headers  

  NFR-10 Low bandwidth    Route-based code        Bundle analyzer;
  (\< 500 KB)             splitting, gzip/brotli, Lighthouse on Slow 3G
                          WebP images,            
                          lazy-loaded charts,     
                          system fonts except     
                          Odia/Devanagari subsets 

  NFR-11 Localization     i18next namespaces per  Missing-key check in CI
                          module; locale stored   
                          on User; dates and      
                          numbers via Intl;       
                          certificates in English 
                          with optional Odia name 

  NFR-12 Accessibility    Semantic HTML, labelled axe-core in Playwright
                          inputs, focus states,   tests
                          4.5:1 contrast,         
                          keyboard-only flows     

  NFR-13 AI cost and      Daily per-user limit,   Unit tests on guard
  safety                  monthly cap, retrieval  logic; log review
                          threshold, no personal  
                          data in prompts         

  NFR-14 Storage          10 MB limit, MIME       API tests with
                          allow-list, video as    oversized and
                          links only              wrong-type files
  -----------------------------------------------------------------------

## 13. Logging, audit and monitoring

Business changes go to the audit log in the database; technical events
go to structured application logs.

  -----------------------------------------------------------------------
  Stream            What              Where             Retention
  ----------------- ----------------- ----------------- -----------------
  Audit log         Changes to        AuditLog table    Life of the
                    attendance,       (insert-only)     system
                    marks,                              
                    enrollment,                         
                    completion,                         
                    certificates,                       
                    passport entries,                   
                    settings: user,                     
                    action, entity,                     
                    id, old value,                      
                    new value,                          
                    timestamp                           

  Application log   Requests (method, pino JSON logs →  7--30 days
                    path, status,     hosting platform  (platform
                    latency, user     log viewer        default)
                    id), errors with                    
                    stack traces,                       
                    cron job runs                       

  AI log            Question,         AssistantLog      90 days
                    retrieved chunk   table             
                    IDs, tokens,                        
                    latency, refusals                   

  Health            GET /health       Uptime monitor    ---
                    (app + DB check)  (e.g. UptimeRobot 
                                      free tier)        
  -----------------------------------------------------------------------

Audit entries are written by a Prisma middleware in the same transaction
as the change, so a change cannot commit without its audit record.
Personal data (passwords, tokens) is never written to any log.

## 14. Development, testing and CI/CD

Every pull request runs lint, type checks and tests; main deploys
automatically, so the demo build is always current.

**Repository layout (monorepo)**

-   apps/web --- React frontend, src/features/\<module\> per module,
    src/locales/{en,or,hi}

-   apps/api --- Express backend,
    src/modules/\<module\>/{routes,controller,service,schema,tests}

-   packages/shared --- Zod schemas, enums (status values), types shared
    by both apps

-   prisma/ --- schema, migrations, seed script covering every role and
    status

**Test levels**

  -----------------------------------------------------------------------
  Level                   Tool                    Focus
  ----------------------- ----------------------- -----------------------
  Unit                    Jest                    Rule functions:
                                                  attendance %,
                                                  eligibility, grade,
                                                  allocation, risk level,
                                                  gap, match % --- with
                                                  boundary values

  Integration             Supertest + test        Endpoints, middleware,
                          PostgreSQL              ownership, transactions

  End-to-end              Playwright              One student from
                                                  enrollment to
                                                  certificate and
                                                  passport; public verify
                                                  page

  Security                Supertest               Role escalation,
                                                  cross-user access,
                                                  public field leakage

  Accessibility /         axe-core, Lighthouse,   NFR-03, NFR-09, NFR-10,
  performance             k6                      NFR-12
  -----------------------------------------------------------------------

**Pipeline (GitHub Actions):** install → lint + typecheck → unit →
integration (PostgreSQL service container) → build → on main: run
migrations and deploy API and web → Playwright smoke test against the
deployed URL.

**Branching:** main (deployed) and dev; one feature branch per task;
pull requests reviewed by the other member.

## 15. Technical risks and traceability

### 15.1 Technical risks

  ------------------------------------------------------------------------
  Risk                    Impact                  Mitigation
  ----------------------- ----------------------- ------------------------
  Serverless cold start   Slow first request;     Function in sin1 next
  and once-a-day cron     a missed or late cron   to Neon; on-demand
  (Amendment 1)           run delays flags        evaluation after
                                                  attendance save; the job
                                                  catches up from its last
                                                  successful run date

  No shared memory across Per-instance rate       Security rate limits
  serverless instances    limits are bypassable   counted in a Postgres
  (Amendment 1)                                   table (rate_limits)

  Free-tier DB connection Errors under load       Neon pooled connection
  limits                                          string (PgBouncer),
                                                  connection_limit=1 per
                                                  function instance
                                                  (Amendment 1)

  Schema drift between    Broken builds           Migrations only through
  members                                         Prisma; schema changes
                                                  reviewed by P2

  QR base URL changes     Old QR codes break      Fixed PUBLIC_BASE_URL
  after printing                                  from week 3; /verify
                                                  route kept permanently

  Odia font rendering in  Broken glyphs on        Embed Noto Sans Oriya in
  PDFs                    certificates            PDFKit; English-only
                                                  certificate as fallback

  AI answers drift from   Wrong guidance to       Similarity threshold,
  materials               students                citations, refusal path,
                                                  feature flag off by
                                                  default

  Daily job slow as data  Late flags              One set-based SQL query
  grows                                           per run; index on
                                                  Attendance(student_id,
                                                  session_id)
  ------------------------------------------------------------------------

### 15.2 Traceability: BRD requirements to modules

  ---------------------------------------------------------------------------------
  BRD requirements        Modules                 Key endpoints / jobs
  ----------------------- ----------------------- ---------------------------------
  BRQ-1.x (F1)            auth                    /auth/\*

  BRQ-2.x, 3.x (F2, F3)   courses, enrollments    /courses, /enrollments

  BRQ-4.x (F4), BRQ-14.x  batches + allocation,   /allocations/\*,
  (F14)                   scheduling-advisor      /scheduling/check

  BRQ-5.x (F5)            sessions + attendance   /sessions/:id/attendance

  BRQ-6.x (F6)            assessments             /assessments, /evaluations

  BRQ-7.x (F7), BRQ-15.x  completion, documents,  /completions/\*,
  (F15)                   verification            /certificates/:id/revoke,
                                                  /public/verify/:code

  BRQ-8.x, 9.x (F8, F9),  reports + dashboard,    /reports/\*, /analytics/outcomes
  BRQ-20.x (F20)          analytics               

  BRQ-C.x, BRQ-10.x (F10) competency, passport    /courses/:id/competencies,
                                                  /students/:id/passport,
                                                  /public/passport/:token

  BRQ-11.x (F11)          intervention            daily cron, /risk-flags

  BRQ-12.x (F12)          competency              /students/:id/gaps,
                                                  /batches/:id/competency-heatmap

  BRQ-13.x (F13)          opportunities           /opportunities,
                                                  /students/me/matches

  BRQ-16.x (F16)          web (i18n), all modules locale on User

  BRQ-17.x (F17)          assistant               /assistant/ask

  BRQ-18.x (F18)          evidence                /evidence/upload-url

  BRQ-19.x (F19)          audit                   Prisma audit middleware,
                                                  /audit-logs

  BRQ-1.4, 2.4, 2.5, 3.5, users, courses,         /admin/users/:id/password,
  4.5, 4.6 (v1.1)         enrollments, batches,   /cycles,
                          dashboard               /admin/enrollments/auto-approve,
                                                  /admin/batches/:id/close,
                                                  .../withdraw
  ---------------------------------------------------------------------------------

The full matrix (every BRQ and BR with its modules, endpoints and tests) is
generated from the code into docs/TRACEABILITY.md and checked in CI.
