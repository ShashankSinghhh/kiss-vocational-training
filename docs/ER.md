# KISS VTMP — Entity–Relationship Summary

Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma) plus the hand-written SQL at the
end of `prisma/migrations/*_r1_r2_schema/migration.sql`. Tables use UUID keys, snake_case names
and an index on every foreign key. This covers Release 1 (core) and Release 2 (competency,
passport, intervention); R3 tables are added in Sprints 11–12.

## Core workflow (R1)

```mermaid
erDiagram
  users ||--o| students : "is"
  users ||--o| trainers : "is"
  users ||--o{ refresh_tokens : "has"
  users ||--o{ notifications : "receives"

  programmes |o--o{ courses : "groups"
  training_cycles ||--o{ course_offerings : "offers"
  courses ||--o{ course_offerings : "offered in"
  training_cycles ||--o{ enrollments : "for"
  students ||--o{ enrollments : "applies"
  enrollments ||--|{ enrollment_preferences : "ranks 1-3"
  courses ||--o{ enrollment_preferences : "chosen in"

  courses ||--o{ batches : "runs as"
  training_cycles ||--o{ batches : "in"
  batches ||--o{ batch_students : "holds"
  enrollments ||--o| batch_students : "allocated as"
  batches ||--o{ trainer_assignments : "taught by"
  trainers ||--o{ trainer_assignments : "assigned to"
  batches ||--o{ training_sessions : "schedules"
  trainers |o--o{ training_sessions : "conducts"

  training_sessions ||--o{ attendance : "records"
  students ||--o{ attendance : "attends"
  batches ||--o{ assessments : "has"
  assessments ||--o{ assessment_results : "scores"
  students ||--o{ assessment_results : "earns"
  batches ||--o{ progress : "tracks"
  enrollments ||--o| evaluations : "final evaluation"

  enrollments ||--o{ certificates : "certified by"
  certificates |o--o| certificates : "superseded by"
  enrollments ||--o{ performance_reports : "reported in"

  users {
    uuid id PK
    text email UK
    text password_hash
    text full_name
    Role role
    Locale locale
    bool is_active
    int failed_login_count
    timestamptz locked_until
    bool must_change_password
  }
  students {
    uuid id PK
    uuid user_id FK,UK
    text roll_no UK
    decimal cgpa "0-10"
    text phone
    text photo_url
  }
  trainers {
    uuid id PK
    uuid user_id FK,UK
    text employee_code UK
    text specialization
  }
  courses {
    uuid id PK
    text code UK
    text title
    int duration_weeks ">0"
    text prerequisites
    bool prerequisites_need_review
    int seat_capacity ">0"
    bool is_active
    uuid programme_id FK
  }
  programmes {
    uuid id PK
    text name UK
    int sort_order
  }
  training_cycles {
    uuid id PK
    text name UK
    date starts_on
    date ends_on
  }
  course_offerings {
    uuid id PK
    uuid course_id FK
    uuid cycle_id FK
    timestamptz enrollment_opens_at
    timestamptz enrollment_closes_at
    bool is_open
  }
  enrollments {
    uuid id PK
    uuid student_id FK
    uuid cycle_id FK
    EnrollmentStatus status
    text reason
    timestamptz submitted_at
    uuid decided_by_id FK
  }
  enrollment_preferences {
    uuid id PK
    uuid enrollment_id FK
    uuid course_id FK
    int rank "1-3"
  }
  batches {
    uuid id PK
    uuid course_id FK
    uuid cycle_id FK
    text name
    int capacity ">0"
    date start_date
    date end_date
    text venue
    BatchStatus status
  }
  batch_students {
    uuid id PK
    uuid batch_id FK
    uuid enrollment_id FK,UK
    uuid student_id FK
  }
  trainer_assignments {
    uuid batch_id PK,FK
    uuid trainer_id PK,FK
  }
  training_sessions {
    uuid id PK
    uuid batch_id FK
    uuid trainer_id FK
    timestamptz starts_at
    timestamptz ends_at
    text venue
    SessionStatus status
  }
  attendance {
    uuid id PK
    uuid session_id FK
    uuid student_id FK
    AttendanceStatus status
    uuid marked_by_id FK
    timestamptz first_marked_at
    timestamptz marked_at
  }
  assessments {
    uuid id PK
    uuid batch_id FK
    AssessmentMode mode
    decimal max_marks ">0"
    decimal weightage ">0"
    bool is_mandatory
  }
  assessment_results {
    uuid id PK
    uuid assessment_id FK
    uuid student_id FK
    decimal marks "0..max_marks"
  }
  evaluations {
    uuid id PK
    uuid enrollment_id FK,UK
    text remarks
    bool recommended
  }
  certificates {
    uuid id PK
    uuid enrollment_id FK
    text public_code UK ">=12 chars"
    CertificateStatus status
    Grade grade
    decimal aggregate_percent
    decimal attendance_percent
    uuid superseded_by_id FK,UK
    int verification_count
    text pdf_object_key
  }
```

## Kernel tables

```mermaid
erDiagram
  users |o--o{ audit_logs : "acted"
  users ||--o{ idempotency_keys : "sent"
  users |o--o{ settings : "last updated"

  audit_logs {
    uuid id PK
    uuid user_id FK "null = system"
    text action
    text entity
    text entity_id
    jsonb old_value
    jsonb new_value
    text ip
    timestamptz created_at
  }
  settings {
    text key PK
    jsonb value
    uuid updated_by_id FK
  }
  idempotency_keys {
    uuid id PK
    text key
    uuid user_id FK
    text route
    text request_hash
    int response_status
    jsonb response_body
  }
  notifications {
    uuid id PK
    uuid user_id FK
    text type
    text title
    timestamptz read_at
  }
  rate_limits {
    text key PK "prefix:sha256(ip)"
    int hits
    timestamptz reset_at
  }
```

`rate_limits` (infrastructure, added for serverless hosting) holds fixed-window counters for the
security rate limits, so every Vercel function instance shares one count. Keys are hashed, and
no raw IPs are stored.

## Competency, passport and intervention (R2)

```mermaid
erDiagram
  courses ||--o{ competencies : "defines"
  competencies ||--o{ assessment_competencies : "evidenced by"
  assessments ||--o{ assessment_competencies : "evidences"
  competencies ||--o{ competency_ratings : "rated on"
  students ||--o{ competency_ratings : "rated"
  batches ||--o{ competency_ratings : "within"
  competencies ||--o{ learning_resources : "remediated by"
  students ||--o{ passport_shares : "shares"
  students ||--o{ risk_flags : "flagged"
  batches ||--o{ risk_flags : "in"
  risk_flags ||--o{ intervention_actions : "addressed by"

  competencies {
    uuid id PK
    uuid course_id FK
    text code "UK per course"
    AssessmentMode mode
    int required_level "1-4"
    bool is_mandatory
  }
  competency_ratings {
    uuid id PK
    uuid student_id FK
    uuid competency_id FK
    uuid batch_id FK
    int level "1-4"
    uuid rated_by_id FK
    timestamptz verified_at
    uuid verified_by_id FK
    timestamptz revoked_at
    text revoked_reason
  }
  learning_resources {
    uuid id PK
    uuid competency_id FK
    LearningResourceType type
    text url
    uuid approved_by_id FK
  }
  passport_shares {
    uuid id PK
    uuid student_id FK
    text token_hash UK
    timestamptz expires_at
    timestamptz revoked_at
  }
  risk_flags {
    uuid id PK
    uuid student_id FK
    uuid batch_id FK
    RiskLevel level
    jsonb reasons
    timestamptz clear_since
    timestamptz closed_at
    timestamptz escalated_at
  }
  intervention_actions {
    uuid id PK
    uuid flag_id FK
    InterventionActionType type
    uuid owner_id FK
    date due_on ">= created"
    text outcome
  }
```

## Evidence, opportunities, analytics and assistant (R3)

```mermaid
erDiagram
  assessments ||--o| rubrics : "scored with"
  assessment_results ||--o{ practical_evidence : "backed by"
  competencies |o--o{ practical_evidence : "proves"
  job_roles ||--o{ job_role_competencies : "requires"
  job_roles ||--o{ opportunities : "offered as"
  opportunities ||--o{ opportunity_interests : "interests"
  students ||--o{ opportunity_interests : "interested"
  enrollments ||--o{ placement_outcomes : "placed"
  opportunities |o--o{ placement_outcomes : "through"
  courses ||--o{ materials : "taught with"
  materials ||--o{ material_chunks : "split into"
  users ||--o{ assistant_logs : "asked"

  rubrics {
    uuid id PK
    uuid assessment_id FK "UK"
    jsonb criteria
    jsonb levels
  }
  practical_evidence {
    uuid id PK
    uuid result_id FK
    uuid competency_id FK "null = none"
    EvidenceKind kind "FILE or LINK"
    text object_key UK "FILE: private store key"
    text url "LINK: https video"
    int size_bytes "max 10 MB"
    jsonb scores "rubric criterion → level"
  }
  job_roles {
    uuid id PK
    text title UK
    bool is_active
  }
  job_role_competencies {
    uuid role_id PK
    text competency_code PK
    int level "1-4"
  }
  opportunities {
    uuid id PK
    uuid role_id FK
    OpportunityType type
    text partner
    date closes_on
  }
  opportunity_interests {
    uuid opportunity_id PK
    uuid student_id PK
  }
  placement_outcomes {
    uuid id PK
    uuid enrollment_id FK
    uuid opportunity_id FK
    PlacementType type
    text employer
    date placed_on
  }
  materials {
    uuid id PK
    uuid course_id FK
    text object_key UK
    MaterialStatus status
    int chunk_count
  }
  material_chunks {
    uuid id PK
    uuid material_id FK
    int ordinal "UK per material"
    text content
    vector embedding "1024 dims, HNSW cosine"
  }
  assistant_logs {
    uuid id PK
    uuid user_id FK
    text mode
    uuid_array chunk_ids
    bool refused
    decimal cost_usd
    int latency_ms
  }
  job_locks {
    text name PK
    timestamptz locked_until
    timestamptz last_success_at
    jsonb last_result
  }
```

- **Job roles name competency codes**, not competency rows: one role ("Solar technician") can
  match courses that share codes. A student's match % is computed on read (BR-22).
- **Outcome analytics** read two materialized views refreshed nightly,
  `analytics_batch_outcomes` and `analytics_course_competency` (counts only); rates are
  computed on read so changed Settings apply at once.
- **`job_locks`** is the lease that keeps two runs of a scheduled job from overlapping, and
  remembers the last success and left-over work so the next run can catch up.
- **Assistant** tables are used only when the assistant is switched on (`AI_ENABLED`); it is
  off on the live site.

## Rules enforced by the database

| Rule | Mechanism |
| --- | --- |
| BR-01 one active enrollment per student per cycle | Partial unique index `enrollments_one_active_per_cycle` on (student_id, cycle_id) where status not in (REJECTED, NOT_COMPLETED) |
| BR-07 0 ≤ marks ≤ max | CHECK `marks >= 0` + trigger `assessment_results_marks_within_max`; trigger on assessments blocks lowering max below an existing result |
| NFR-06 / BR-12 audit log immutable | Triggers on `audit_logs` reject UPDATE, DELETE and TRUNCATE |
| F11 one open flag per student and batch | Partial unique index `risk_flags_one_open_per_student_batch` where closed_at is null |
| F15 one VALID certificate per enrollment | Partial unique index `certificates_one_valid_per_enrollment` where status = VALID |
| BR-19 certificate codes ≥ 12 chars | CHECK `certificates_public_code_length` |
| Certificates only for passing grades | CHECK `grade <> 'NOT_COMPLETED'` |
| Revocations carry a reason | CHECKs on certificates and competency_ratings |
| Ranges | rank 1–3, competency levels 1–4, CGPA 0–10, capacity/duration/max marks/weightage > 0, date and time ordering, due_on ≥ created date |
| Evidence is a file or a link, never both | CHECK `practical_evidence_file_or_link`; files ≤ 10 MB |
| Job role levels 1–4 | CHECK `job_role_competencies_level_range` |
| Foreign keys are indexed | Every foreign key has an index starting with its columns (checked by a test) |
| Membership matches its enrollment | Composite FK batch_students(enrollment_id, student_id) → enrollments(id, student_id) |

Derived values (attendance %, aggregate, gap, match %) are never stored, except the frozen
snapshots on `certificates` and `performance_reports`.

## Changes after release (BRD/TAD v1.1)

- Migration `20261028100000_password_change_and_prerequisite_review` adds
  `users.must_change_password` (an admin chose the password; cleared when the user changes it,
  BR-27) and `courses.prerequisites_need_review` (default true; when false, automatic approval
  doesn't hold applications for that course's prerequisites, BRQ-3.5).
- No other table changed. Batch status `CLOSED` and enrollment status `WITHDRAWN` already existed
  and are now used (BR-25, BR-26). A student withdrawn from a running batch keeps their
  `batch_students` row so their records stay linked; seat counts leave such rows out.
- Rules added in v1.1 that the services enforce (not the database): BR-23 (no overlapping
  trainings), BR-24 (batch dates and enrollment windows inside the cycle), BR-25 (closing),
  BR-26 (withdrawal), BR-28 (a needed trainer stays active).

## Programmes (2026-11-03)

- Migration `20261103100000_programmes` adds `programmes` (a group of related courses, e.g.
  *Computer & Digital Skills*; unique `name`, `sort_order` for display) and the optional
  `courses.programme_id` (FK, `ON DELETE RESTRICT`, indexed). Students choose a cycle, then a
  programme, then one course in it; each course still runs in its own batches.
- Programme changes are audited (`PROGRAMME_CREATED`, `PROGRAMME_UPDATED`). How many courses one
  application may name stays the setting `enrollment.maxPreferences` (seeded as 1 at KISS).
