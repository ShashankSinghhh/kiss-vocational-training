# KISS Vocational Training Management Portal --- Business Requirements Document

Oct 9, 2026 (v1.0) · updated Nov 1, 2026 (v1.2) · \@Shashank Singh

## 1. Document control

This BRD (v1.2, updated after release) states what the business needs from
the portal; the companion Project Documentation v2.1 states how it will
be built.

  -----------------------------------------------------------------------
  Item                                Detail
  ----------------------------------- -----------------------------------
  Document                            Business Requirements Document
                                      (BRD)

  Version                             1.3 --- updated after Release 3
                                      with the changes made since (see
                                      the version table)

  Source documents                    KISS VTMP Project Planning, System
                                      Design & SE Documentation v2.1;
                                      Feature List (features 1--20)

  Project type                        Group software engineering project,
                                      2 members, one semester

  Sponsor / approver                  Project guide (to be named)

  Users covered                       Students, Trainers, Administration,
                                      Public Verifier, Employers /
                                      Placement Cell
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Version                             Change
  ----------------------------------- -----------------------------------
  1.0                                 First BRD: core workflow from v2.1
                                      plus business case and requirements
                                      for unique features 10--20

  1.1 (2026-11-01)                    Post-release update. Section 5.4
                                      lists the scope changes; Section
                                      8.1 adds six requirements (BRQ-1.4,
                                      2.4, 2.5, 3.5, 4.5, 4.6); BR-06,
                                      BR-09, BR-19 and BR-20 are amended;
                                      Section 10.3 adds BR-23 to BR-28.
                                      Each change came from the
                                      post-release site test run (Round
                                      1) or the logic review (Round 2),
                                      recorded in internal/PROGRESS.md.

  1.2 (2026-11-01)                    Automation: Section 8.2 adds
                                      BRQ-1.5, 3.6, 4.7, 4.8, 7.4, 9.5,
                                      9.6, 20.4 and 20.5, the nine steps
                                      the Round 2 review found done by
                                      hand. No business rule changes;
                                      every threshold is a setting the
                                      admin changes on the Automation
                                      page.

  1.3 (2026-11-05)                    Open to every student: academic
                                      marks (CGPA) are no longer
                                      recorded or used. BR-04 now
                                      orders by preference rank, then
                                      submission time; BRQ-3.5 drops
                                      the minimum-CGPA rule. Courses
                                      are grouped into programmes
                                      (cycle → programme → course).

  -----------------------------------------------------------------------

## 2. Executive summary

KISS needs one rule-driven portal that takes every vocational student
from enrollment to a verifiable certificate, and then shows what that
student can actually do.

Today training runs on spreadsheets, paper registers and informal
messages. Eligibility is checked by hand, students cannot see their own
progress, and certificates cannot be verified. The portal replaces this
with a single workflow shared by Students, Trainers and Administration,
where the system --- not individuals --- decides completion eligibility.

The core workflow (features 1--9) is the minimum the institution needs.
Four unique features turn it from a record-keeping tool into an outcomes
tool:

-   **Skill Passport (F10)** --- a verified record of competencies each
    student has demonstrated, shareable with employers.

-   **Early Intervention System (F11)** --- flags students whose
    attendance or marks are declining while there is still time to act.

-   **Competency Gap Analyzer (F12)** --- compares required skills with
    demonstrated ones and recommends remedial practice.

-   **QR-Based Certificate Verification (F15)** --- lets any employer
    confirm a certificate is genuine in seconds.

The remaining innovations (F13, F14, F16--F20) are planned as later
enhancements. Section 9 analyses each unique feature; Section 15 sets
the release order for a two-person team.

## 3. Business background and problem statement

The institution\'s vocational programme has no system of record, so seat
allocation, eligibility and certification depend on manual work that is
slow, inconsistent and unverifiable.

  -----------------------------------------------------------------------
  \#                Business problem  Business impact   Addressed by
  ----------------- ----------------- ----------------- -----------------
  P1                Enrollment and    Over-filled       F3, F4, F14
                    batch allocation  batches, unfair   
                    done by hand with placement, admin  
                    no view of seat   hours lost each   
                    availability      cycle             

  P2                Attendance and    Eligibility       F5, F6, F7
                    marks scattered   checks are slow   
                    across registers  and inconsistent  
                                      between trainers  

  P3                Students cannot   Problems are      F5, F6, F11
                    see their         discovered only   
                    attendance,       at the end of the 
                    progress or       course            
                    results in real                     
                    time                                

  P4                Certificates      Certificates      F7, F15
                    issued without a  carry little      
                    consistent        weight with       
                    eligibility check employers;        
                    or authenticity   forgery risk      
                    check                               

  P5                No record of who  Disputes cannot   F19
                    changed           be resolved; no   
                    attendance or     accountability    
                    marks                               

  P6                Certificates      Employers cannot  F10, F12, F13,
                    state a course    judge job         F18
                    name, not the     readiness;        
                    skills a student  placement is      
                    can perform       harder            

  P7                Struggling        Avoidable         F11, F12
                    students are      drop-outs and     
                    identified late   non-completions   
                    or not at all                       

  P8                Many students and Low adoption;     F16
                    families are more reliance on staff 
                    comfortable in    to relay          
                    Odia or Hindi,    information       
                    often on slow                       
                    connections                         
  -----------------------------------------------------------------------

Problems P1--P5 come from the v2.1 documentation. P6--P8 are the
business gaps that justify the unique features; they should be confirmed
with the training office.

## 4. Business objectives and success metrics

Success means one student can travel the whole path from enrollment to a
verified certificate and Skill Passport with no offline step.

  -----------------------------------------------------------------------
  ID                Business          KPI / success     Target
                    objective         measure           (prototype)
  ----------------- ----------------- ----------------- -----------------
  BO-1              Digitize the full Workflow stages   12 of 12 stages
                    training workflow completed without 
                                      an offline step   

  BO-2              Give each role    Unauthorized role 100% of security
                    its own interface or ownership      test cases pass
                    and permissions   requests rejected 
                                      by the server     

  BO-3              Reduce manual     Allocation and    Allocation
                    allocation and    attendance %      preview for 500
                    tracking effort   computed by the   students in under
                                      system            5 s

  BO-4              Give students     Time from trainer Immediate (next
                    transparent,      entry to student  page load)
                    real-time         visibility        
                    progress                            

  BO-5              Issue             Certificates      100% carry a
                    trustworthy,      issued only to    unique ID and QR;
                    verifiable        eligible          verification in
                    certificates      students;         under 3 s
                                      verifiable by QR  

  BO-6              Identify at-risk  Students flagged  Flags raised
                    students early    before the final  within 1 day of a
                                      assessment        trigger

  BO-7              Show employers    Completed         100% of certified
                    what students can students with a   students
                    do                verified Skill    
                                      Passport          

  BO-8              Make every        Changes to        100% logged with
                    sensitive change  attendance,       old and new value
                    accountable       marks, approvals  
                                      and certificates  
                                      logged            

  BO-9              Demonstrate a     SRS, UML, ER,     All delivered by
                    complete SE       test plan, WBS,   final submission
                    lifecycle         schedule, risk    
                                      register          
                                      delivered         
  -----------------------------------------------------------------------

BO-1--BO-5, BO-8 and BO-9 restate OBJ-1--OBJ-7 from v2.1; BO-6 and BO-7
are added by the unique features. Targets are prototype targets and
should be reviewed with the guide.

## 5. Scope

Release 1 delivers the core workflow; Release 2 adds the four
high-impact innovations; Release 3 holds the remaining enhancements as
stretch goals.

### 5.1 In scope

  -----------------------------------------------------------------------
  Release                 Features                Notes
  ----------------------- ----------------------- -----------------------
  R1 --- Core MVP         F1--F9: authentication  Includes the audit log
                          and RBAC, courses and   for attendance, marks
                          electives, enrollment,  and approvals (BR-12)
                          batch and trainer       because the core
                          allocation, attendance, business rules depend
                          progress and            on it
                          assessment, certificate 
                          generation, performance 
                          reports, admin          
                          dashboard               

  R2 --- Differentiators  F10 Skill Passport, F11 Requires a competency
                          Early Intervention, F12 model per course
                          Competency Gap          (Section 9.1)
                          Analyzer, F15 QR        
                          verification            

  R3 --- Enhancements     F13 Career Matcher, F14 Built only if R2 is
                          Smart Allocation, F16   complete and tested
                          Multilingual, F17 AI    
                          Assistant, F18          
                          Practical Evidence, F19 
                          full Audit Trail        
                          viewer, F20 Outcome     
                          Analytics               
  -----------------------------------------------------------------------

### 5.2 Out of scope

-   Payroll or trainer salary management.

-   Hosting full course content (videos, LMS material) --- F17 reads
    only approved documents uploaded by admins.

-   Biometric or hardware attendance.

-   Multi-campus or enterprise deployment.

-   Online fee payment.

-   Native mobile apps (the web app is responsive instead).

### 5.3 Changes from v2.1 scope

  -----------------------------------------------------------------------
  Item              v2.1 position     BRD position      Reason
  ----------------- ----------------- ----------------- -----------------
  QR certificate    Could             Should (R2)       High business
  verification                                          value for
                                                        employers; low
                                                        build cost on top
                                                        of unique
                                                        certificate IDs

  At-risk student   Should            Extended into F11 Adds trend
  list (FR-26)                        Early             detection and
                                      Intervention      tracked remedial
                                                        actions

  AI                Won\'t            Could (R3),       Kept out of the
  recommendations                     limited to F17    critical path;
                                      over approved     fully optional
                                      materials         

  Competency /      Not covered       Should (R2)       Needed by F10 and
  skill tracking                                        F12
  -----------------------------------------------------------------------

### 5.4 Changes after release (v1.1)

These capabilities were added after Release 3, from the team's own use of the portal and two reviews of it. Each is now in scope and traced below.

  -----------------------------------------------------------------------
  Item              v1.0 position     v1.1 position     Reason
  ----------------- ----------------- ----------------- -----------------
  Automatic         Every application Admin-set rules   About 2,000
  approval          reviewed by hand  approve           applications a
                    (BRQ-3.3)         qualifying        cycle; the admin
                                      applications      stays in control
                                      (BRQ-3.5)         of the rules

  Choice of         The system showed Students choose;  A new cycle was
  training cycle    one cycle         each cycle says   invisible to
                                      whether it takes  students
                                      applications
                                      (BRQ-2.4)

  Record clean-up   Not covered       Bulk deactivate;  Test and
                                      delete records    duplicate records
                                      never used        cluttered every
                                      (BRQ-2.5)         list

  Account recovery  Not covered       Admin password    A forgotten
                                      reset and unlock; password left a
                                      own password at   user locked out
                                      first sign-in     for good
                                      (BRQ-1.4, BR-27)

  End of training   Not covered       Withdraw a        Dropouts stayed
                                      student; close a  enrolled and
                                      finished batch    batches never
                                      (BRQ-4.5,         closed
                                      BRQ-4.6, BR-25,
                                      BR-26)

  Automation (v1.2) Every step by     Nightly jobs and  Reminders,
                    hand              notices, each     closing, waitlist
                                      with a switch     and follow-ups
                                      (BRQ-4.7 to       were forgotten or
                                      BRQ-20.5)         slow
  -----------------------------------------------------------------------

## 6. Stakeholders and user roles

Three roles log in and do the work; two external parties only consume
verified outputs.

  -----------------------------------------------------------------------
  Stakeholder       Type              Business need     Key capabilities
  ----------------- ----------------- ----------------- -----------------
  Student           Primary user      Enroll fairly,    Catalogue,
                                      see progress, get enrollment, my
                                      a credible        training, Skill
                                      certificate and   Passport, gap
                                      job leads         report, AI
                                                        assistant,
                                                        opportunities,
                                                        documents

  Trainer           Primary user      Record attendance My batches,
                                      and marks         attendance,
                                      quickly; know who assessments,
                                      needs help        rubric evaluation
                                                        with evidence,
                                                        intervention list

  Administration    Primary user      Run cycles,       Master data,
  (training office)                   allocate seats,   enrollment
                                      approve           review,
                                      completion,       allocation,
                                      report outcomes   completion queue,
                                                        certificates,
                                                        dashboards, audit
                                                        log

  Public Verifier / External          Confirm a         Public
  Employer                            certificate or    verification
                                      skill profile is  page, shared
                                      genuine           Skill Passport
                                                        link (no login)

  Placement cell /  External (via     Reach students    Opportunities
  Industry partner  Admin)            whose skills fit  published by
                                      open roles        Admin; matched
                                                        candidate lists
                                                        (R3)

  Project guide /   Sponsor           A working,        Approves this
  Institution                         well-documented   BRD; reviews
  management                          prototype;        analytics
                                      outcome evidence  

  Development team  Delivery          Clear,            Owns build, test
  (2 members)                         prioritized,      and documentation
                                      testable          
                                      requirements      
  -----------------------------------------------------------------------

Open question: whether employers get their own login in R3 or continue
to work only through Admin-published opportunities and public links.

## 7. Current state vs future state

The future process replaces five manual hand-offs with system-enforced
steps and adds three outcome steps the current process lacks.

  -----------------------------------------------------------------------
  Activity                Current state           Future state
  ----------------------- ----------------------- -----------------------
  Enrollment              Paper or spreadsheet    Online ranked
                          forms; no seat          preferences inside an
                          visibility              open window; one per
                                                  cycle

  Allocation              Manual placement by     System allocation with
                          staff                   preview, capacity and
                                                  clash checks

  Attendance and marks    Registers kept by each  Recorded per session,
                          trainer                 validated, audit-logged

  Struggling students     Noticed at the end, if  Flagged automatically
                          at all                  with tracked remedial
                                                  action

  Completion              Judged by hand          Eligibility computed
                                                  from BR-09, then
                                                  approved

  Certificate             Printed; cannot be      PDF with unique ID and
                          verified                QR, verifiable online

  Skills record           None                    Verified Skill
                                                  Passport, shareable
                                                  with employers
  -----------------------------------------------------------------------

future-state process · 4 roles, 13 steps

The highlighted loop is the main change in the training phase: an
at-risk flag sends the student back through remedial work before final
evaluation. Students who fail the eligibility check are marked Not
Completed with a reason.

## 8. Core business requirements (F1--F9)

All 30 core requirements are Must for Release 1 unless marked Should;
each traces to the v2.1 functional requirements (FR) and business rules
(BR).

  -----------------------------------------------------------------------------
  ID             Feature        Business          Priority       Traces to
                                requirement                      
  -------------- -------------- ----------------- -------------- --------------
  BRQ-1.1        F1 Auth        Users log in and  Must           FR-01, NFR-01
                                out securely with                
                                email and                        
                                password                         

  BRQ-1.2        F1 Auth        Each role         Must           FR-02, FR-03
                                (Student,                        
                                Trainer, Admin)                  
                                sees only its own                
                                dashboard and                    
                                permitted                        
                                actions, enforced                
                                on the server                    

  BRQ-1.3        F1 Auth        Users can manage  Should         FR-04
                                their profile and                
                                change their                     
                                password                         

  BRQ-2.1        F2 Courses     Admin can create, Must           FR-30
                                update and                       
                                deactivate                       
                                vocational                       
                                courses                          

  BRQ-2.2        F2 Courses     Each course shows Must           FR-10
                                description,                     
                                duration,                        
                                prerequisites,                   
                                seat capacity and                
                                enrollment window                

  BRQ-2.3        F2 Courses     Admin can open    Must           FR-31, BR-02
                                and close                        
                                elective                         
                                availability per                 
                                course and cycle                 

  BRQ-3.1        F3 Enrollment  Students browse   Must           FR-11
                                courses and                      
                                submit up to                     
                                three ranked                     
                                preferences                      

  BRQ-3.2        F3 Enrollment  Only one active   Must           BR-01, BR-02
                                enrollment per                   
                                student per                      
                                cycle, only                      
                                inside the open                  
                                window                           

  BRQ-3.3        F3 Enrollment  Admin approves,   Must           FR-32
                                rejects (with                    
                                reason) or                       
                                waitlists                        
                                requests, singly                 
                                or in bulk                       

  BRQ-3.4        F3 Enrollment  Students track    Must           FR-12
                                their enrollment                 
                                status and                       
                                reasons                          

  BRQ-4.1        F4 Batches     Admin creates     Must           FR-33
                                batches with                     
                                capacity, dates                  
                                and venue                        

  BRQ-4.2        F4 Batches     System allocates  Must           FR-34, BR-03,
                                approved students                BR-04
                                by preference and                
                                priority rule,                   
                                with a preview                   
                                before confirming                

  BRQ-4.3        F4 Batches     Admin assigns     Must           FR-35
                                trainers and                     
                                schedules                        
                                sessions                         

  BRQ-4.4        F4 Batches     No batch exceeds  Must           BR-03
                                capacity;                        
                                overflow is                      
                                waitlisted                       

  BRQ-5.1        F5 Attendance  Trainers mark     Must           FR-22, BR-05
                                present / absent                 
                                / late per                       
                                session for their                
                                own batches only                 

  BRQ-5.2        F5 Attendance  Attendance edits  Must           BR-06, BR-12
                                allowed for 48                   
                                hours; later                     
                                edits by Admin                   
                                only, logged                     

  BRQ-5.3        F5 Attendance  System calculates Must           FR-14, BR-08
                                attendance % and                 
                                shows absenteeism                
                                per student and                  
                                batch                            

  BRQ-6.1        F6 Assessment  Trainers create   Must           FR-24
                                assessments                      
                                (theory or                       
                                practical) with                  
                                max marks,                       
                                weightage and                    
                                mandatory flag                   

  BRQ-6.2        F6 Assessment  Marks validated   Must           BR-07
                                between 0 and max                
                                marks                            

  BRQ-6.3        F6 Assessment  Trainers record   Must           FR-23, FR-25
                                progress                         
                                milestones and a                 
                                final evaluation                 
                                with completion                  
                                recommendation                   

  BRQ-6.4        F6 Assessment  System calculates Must           BR-11
                                weighted                         
                                aggregate score                  
                                and grade band                   

  BRQ-7.1        F7             System checks     Must           BR-09
                 Certificates   completion                       
                                eligibility                      
                                (attendance,                     
                                mandatory                        
                                assessments,                     
                                aggregate,                       
                                recommendation)                  

  BRQ-7.2        F7             Certificate       Must           BR-10, FR-38
                 Certificates   generated only                   
                                after Admin                      
                                approval, with a                 
                                unique                           
                                non-guessable ID,                
                                as a downloadable                
                                PDF                              

  BRQ-7.3        F7             A record of every Must           FR-38, BR-12
                 Certificates   certificate                      
                                issued is kept                   

  BRQ-8.1        F8 Reports     Individual        Must           FR-38
                                student                          
                                performance                      
                                report (PDF)                     

  BRQ-8.2        F8 Reports     Batch-wise and    Should         FR-39
                                course-wise                      
                                reports with                     
                                completion rates                 
                                and results,                     
                                exportable as CSV                
                                / PDF                            

  BRQ-9.1        F9 Dashboard   Admin dashboard   Must           FR-36
                                shows counts of                  
                                students,                        
                                courses, trainers                
                                and batches                      

  BRQ-9.2        F9 Dashboard   Dashboard shows   Should         FR-36, FR-39
                                enrollment,                      
                                completion and                   
                                performance                      
                                statistics with                  
                                charts                           

  BRQ-9.3        F9 Dashboard   Students and      Must           FR-02
                                trainers see role                
                                dashboards with                  
                                their own key                    
                                figures                          

  BRQ-9.4        F9 Dashboard   Admin views the   Must           FR-37
                                completion queue                 
                                with the                         
                                system\'s                        
                                eligibility                      
                                result                           
  -----------------------------------------------------------------------------

### 8.1 Requirements added in v1.1

Six requirements added after release; each extends a core feature and is cited by automated tests like the rest.

  -----------------------------------------------------------------------------
  ID             Feature        Business          Priority       Traces to
                                requirement
  -------------- -------------- ----------------- -------------- --------------
  BRQ-1.4        F1 Auth        Admins reset a    Must           BR-27
                                forgotten
                                password and
                                unlock a locked
                                account; a
                                password set by
                                an admin must be
                                changed at the
                                next sign-in

  BRQ-2.4        F2 Courses     Students choose   Must           BR-02
                                the training
                                cycle; each cycle
                                shows whether it
                                takes
                                applications,
                                open ones first

  BRQ-2.5        F2 Courses     Admins deactivate Should         BR-12
                                courses and
                                accounts in bulk
                                and delete
                                records never
                                used; lists show
                                active records by
                                default

  BRQ-3.5        F3 Enrollment  Applications      Should         BR-01, BR-23
                                meeting admin-set
                                rules
                                (prerequisite
                                review per
                                course) are
                                approved
                                automatically and
                                audited

  BRQ-4.5        F4 Batches     Admins withdraw a Must           BR-26
                                student from a
                                planned or
                                running batch
                                with a reason the
                                student sees

  BRQ-4.6        F4 Batches     Admins close a    Must           BR-25
                                batch after its
                                end date once
                                every student has
                                a decision; the
                                dashboard lists
                                ended batches
                                still open
  -----------------------------------------------------------------------------

### 8.2 Requirements added in v1.2 (automation)

Nine steps the Round 2 review found done by hand. Each runs in the nightly job or at the moment it applies, sends in-app notices only (no paid email or SMS), and has a switch or limit on the admin's Automation page.

  -----------------------------------------------------------------------------
  ID             Feature        Business          Priority       Traces to
                                requirement
  -------------- -------------- ----------------- -------------- --------------
  BRQ-1.5        F1 Auth        Admins create     Should         BR-27
                                student accounts
                                from a CSV file,
                                checked row by
                                row first; all
                                rows or none are
                                created, each
                                must change the
                                shared first
                                password

  BRQ-3.6        F3 Enrollment  When automatic    Should         BR-01, BR-23
                                approval is on,
                                its rules also
                                apply to
                                applications
                                already waiting:
                                when the rules
                                change and every
                                night

  BRQ-4.7        F4 Batches     A finished batch  Should         BR-25
                                with every
                                student decided
                                closes
                                automatically
                                after a set
                                number of days

  BRQ-4.8        F4 Batches     When a seat frees Could          BR-03, BR-04
                                up, the next
                                waitlisted
                                applicant is
                                placed and told,
                                if the admin
                                switches it on

  BRQ-7.4        F7 Completion  Students who meet Should         BR-09
                                every completion
                                rule start
                                selected, so the
                                admin approves
                                them in one step

  BRQ-9.5        F9 Dashboards  Daily reminders:  Should         BR-06
                                trainers about
                                sessions to mark,
                                admins about
                                waiting
                                applications and
                                finished batches
                                without decisions

  BRQ-9.6        F9 Dashboards  Students are told Should         BR-22
                                when applications
                                open, a session
                                is cancelled, a
                                passport link is
                                about to expire,
                                or a new
                                opportunity
                                matches their
                                skills

  BRQ-20.4       F20 Analytics  Outcome analytics Could          ---
                                refresh after
                                certificates are
                                issued when they
                                are older than a
                                set number of
                                minutes

  BRQ-20.5       F20 Analytics  Admins are asked  Could          ---
                                a set number of
                                days after a
                                placement whether
                                the student is
                                still in the job
  -----------------------------------------------------------------------------

## 9. Unique features: analysis and business requirements (F10--F20)

The four recommended differentiators (F10, F11, F12, F15) share one
foundation --- a competency model per course --- so building it once
unlocks all four at low extra cost.

unique features · impact vs effort

F11 and F15 reuse data the core already collects, so they are cheap. F10
and F12 cost more, but only because of the competency model, which F13
and F18 then reuse. F17 carries the most effort and risk for its value.

### 9.1 Shared foundation: the competency model

Every course defines a list of competencies (for example \"Wire a
single-phase distribution board\"). Each competency has a code, a type
(theory or practical), a required proficiency level (1--4) and the
assessments that evidence it. Assessment results and rubric evaluations
then roll up into a per-student competency score.

  -----------------------------------------------------------------------
  ID                      Requirement             Priority
  ----------------------- ----------------------- -----------------------
  BRQ-C.1                 Admin defines           Should
                          competencies per course 
                          with code, title, type, 
                          required level and      
                          linked assessments      

  BRQ-C.2                 Trainers rate each      Should
                          student on each         
                          competency (level 1--4) 
                          using a rubric          

  BRQ-C.3                 Job roles (for F13) are Could
                          defined as a list of    
                          required competencies   
                          and levels              
  -----------------------------------------------------------------------

Proficiency levels: 1 Aware, 2 Assisted, 3 Independent, 4 Can teach
others. A competency is **verified** when the student reaches the
required level and a trainer confirms it.

### 9.2 F10 Skill Passport

**Business value.** Certificates say which course was finished;
employers want to know which tasks the student can do. A passport of
trainer-verified competencies answers that and addresses P6.

  -----------------------------------------------------------------------
  ID                      Requirement             Priority
  ----------------------- ----------------------- -----------------------
  BRQ-10.1                Each student has one    Should
                          Skill Passport listing  
                          every verified          
                          competency, its level,  
                          date verified and       
                          verifying trainer       

  BRQ-10.2                Practical skills are    Should
                          tracked separately from 
                          theory, with links to   
                          evidence (F18) when     
                          present                 

  BRQ-10.3                Students generate a     Should
                          shareable link or QR to 
                          a read-only passport,   
                          and can revoke it       

  BRQ-10.4                The passport spans      Should
                          training cycles, so     
                          skills from earlier     
                          courses remain          
  -----------------------------------------------------------------------

**Rules.** Only a trainer assigned to the student\'s batch can verify a
competency (extends BR-05). A verified entry cannot be deleted, only
revoked by Admin with a reason, and every change is logged (BR-12).
Shared links show name, photo (optional), competencies and certificates
only --- never marks or attendance.

**Acceptance criteria.** A certified student opens their passport and
sees each verified competency with level and date. A shared link opened
without login shows the read-only profile; after revocation it shows
\"Link no longer active\".

### 9.3 F11 Early Intervention System

**Business value.** Today students fall below 75% attendance or 40%
aggregate before anyone notices. Flagging them early protects completion
rates (P7) and extends v2.1 FR-26 from a list into a tracked process.

  -----------------------------------------------------------------------
  ID                      Requirement             Priority
  ----------------------- ----------------------- -----------------------
  BRQ-11.1                System calculates a     Should
                          daily risk level (Low / 
                          Medium / High) for      
                          every student in an     
                          Active batch            

  BRQ-11.2                Trainers and Admin see  Should
                          a flagged-students list 
                          with the reason for     
                          each flag               

  BRQ-11.3                Trainers record a       Should
                          remedial action         
                          (counselling, extra     
                          session, practice task) 
                          with owner and due date 

  BRQ-11.4                System tracks whether   Should
                          the student improves    
                          after the action and    
                          closes or escalates the 
                          flag                    

  BRQ-11.5                Students see their own  Should
                          flag with a supportive  
                          message and the agreed  
                          action                  
  -----------------------------------------------------------------------

**Rules (defaults, all configurable).** Medium risk: attendance below
80%, or 3 consecutive absences, or an assessment below 50%. High risk:
attendance below 75% (the BR-09 threshold), or projected aggregate below
40%, or a drop of 15 points between consecutive assessments. A flag
closes automatically when all triggers clear for 7 days; an unresolved
High flag after 14 days escalates to Admin.

**Acceptance criteria.** A student with 74.99% attendance is High risk
within one day of the session being marked. Recording an action and the
student returning above thresholds closes the flag and keeps its
history.

### 9.4 F12 Competency Gap Analyzer

**Business value.** Turns marks into a clear next step: which skills are
missing and what to practise. Helps students improve before final
assessment and gives trainers a batch-level view of weak topics.

  --------------------------------------------------------------------------
  ID                      Requirement                Priority
  ----------------------- -------------------------- -----------------------
  BRQ-12.1                For each student, compare  Should
                          required level with        
                          demonstrated level for     
                          every course competency    

  BRQ-12.2                Show gaps ranked by size,  Should
                          separating                 
                          not-yet-assessed from      
                          assessed-but-below-level   

  BRQ-12.3                Recommend a remedial       Should
                          session, practice task or  
                          resource mapped to each    
                          gap competency             

  BRQ-12.4                Trainers see a batch       Should
                          heatmap of competencies by 
                          student to plan remedial   
                          sessions                   

  BRQ-12.5                Against a target job role  Could
                          (F13), show the gap        
                          between the student\'s     
                          passport and the role\'s   
                          requirements               
  --------------------------------------------------------------------------

**Rules.** Gap = required level − demonstrated level, floored at 0.
Recommendations come only from a resource list curated by trainers or
Admin. A large gap on a mandatory competency also raises an F11 flag.

**Acceptance criteria.** A student with level 1 on a level-3 competency
sees a gap of 2 and at least one recommended action. The batch heatmap
shows that competency highlighted for every student below level.

### 9.5 F15 QR-Based Certificate Verification

**Business value.** Employers can confirm authenticity in seconds
without contacting the institution (P4). Builds directly on the unique
certificate ID already required by BR-10.

  -----------------------------------------------------------------------
  ID                      Requirement             Priority
  ----------------------- ----------------------- -----------------------
  BRQ-15.1                Each certificate PDF    Should
                          carries its unique ID   
                          and a QR code pointing  
                          to the public           
                          verification page       

  BRQ-15.2                Anyone can verify by    Should
                          scanning the QR or      
                          typing the ID, without  
                          logging in              

  BRQ-15.3                The page shows only     Should
                          name, course, grade,    
                          issue date and status:  
                          Valid, Revoked or Not   
                          found                   

  BRQ-15.4                Admin can revoke a      Should
                          certificate with a      
                          reason; status changes  
                          immediately and is      
                          logged                  

  BRQ-15.5                Verification attempts   Could
                          are counted per         
                          certificate and         
                          rate-limited per IP     
  -----------------------------------------------------------------------

**Rules.** IDs are random and at least 12 characters, never sequential.
Revoked certificates stay in the record and show \"Revoked\" with the
date, not the reason. Reissue creates a new ID and marks the old one
Superseded.

**Acceptance criteria.** Scanning a valid certificate\'s QR on a phone
shows \"Valid\" with matching details. An invalid ID shows \"Certificate
not found\" (v2.1 TC-18). A revoked certificate shows \"Revoked\".

### 9.6 Additional enhancements (Release 3)

These seven features add value but each needs extra data, content or
effort, so they follow once R2 is stable.

  --------------------------------------------------------------------------------
  Feature         Business value   Key business      Depends on     Priority
                                   requirements                     
  --------------- ---------------- ----------------- -------------- --------------
  F13 Career and  Connects         BRQ-13.1 Admin    F10, F12,      Could
  Opportunity     training to      publishes         BRQ-C.3        
  Matcher         placement; shows internships,                     
                  students why     apprenticeships                  
                  skills matter    and jobs with                    
                                   required                         
                                   competencies.                    
                                   BRQ-13.2 System                  
                                   ranks                            
                                   opportunities by                 
                                   match % against                  
                                   the student\'s                   
                                   passport.                        
                                   BRQ-13.3 Student                 
                                   sees missing                     
                                   skills for a                     
                                   target role (via                 
                                   F12). BRQ-13.4                   
                                   Student can mark                 
                                   interest; Admin                  
                                   sees interested,                 
                                   matched students                 

  F14 Smart Batch Prevents clashes BRQ-14.1 Warn     F4 allocation  Could
  and Resource    and over-filled  when a batch      (BR-03, BR-04) 
  Allocation      batches before   nears or exceeds                 
                  they happen      capacity.                        
                                   BRQ-14.2 Detect                  
                                   trainer                          
                                   double-booking                   
                                   and venue or                     
                                   timetable clashes                
                                   when scheduling.                 
                                   BRQ-14.3 Suggest                 
                                   feasible batch,                  
                                   trainer and slot                 
                                   options in the                   
                                   allocation                       
                                   preview                          

  F16             Wider adoption   BRQ-16.1 All UI   Translation of Could
  Multilingual    by students and  text in English,  UI strings     
  and             families more at Odia and Hindi,   (needs native  
  low-bandwidth   ease in Odia or  switchable per    reviewers)     
  interface       Hindi            user. BRQ-16.2                   
                                   Certificates                     
                                   remain in                        
                                   English, with                    
                                   optional Odia                    
                                   name line.                       
                                   BRQ-16.3 Pages                   
                                   usable on 3G:                    
                                   core pages under                 
                                   500 KB, images                   
                                   lazy-loaded.                     
                                   BRQ-16.4 Keyboard                
                                   navigation and                   
                                   screen-reader                    
                                   labels (WCAG 2.1                 
                                   AA as goal)                      

  F17 AI Training 24×7 help with   BRQ-17.1 Answers  Approved       Could
  Assistant       concepts and     only from course  material       
                  practice outside materials         library; an    
                  class            approved by       LLM API with   
                                   Admin, citing the cost limit     
                                   source. BRQ-17.2                 
                                   Generates                        
                                   practice                         
                                   questions per                    
                                   competency.                      
                                   BRQ-17.3 Explains                
                                   concepts at a                    
                                   simpler level on                 
                                   request. BRQ-17.4                
                                   Recommends                       
                                   resources tied to                
                                   F12 gaps.                        
                                   BRQ-17.5 Declines                
                                   out-of-scope                     
                                   questions; usage                 
                                   logged                           

  F18 Practical   Makes practical  BRQ-18.1 Trainers Competency     Could
  Assessment      marks defensible attach photo,     model; file    
  Evidence        and supports     video link or     storage (size  
                  passport         document evidence limit e.g. 10  
                  verification     to a practical    MB)            
                                   assessment.                      
                                   BRQ-18.2                         
                                   Rubric-based                     
                                   scoring with                     
                                   named criteria                   
                                   and levels.                      
                                   BRQ-18.3 Evidence                
                                   linked to the                    
                                   competency it                    
                                   verifies                         

  F19 Audit Trail Accountability   BRQ-19.1 Log      Logging itself Must (logging)
  and Change      and dispute      changes to        is R1 (BR-12); / Should
  History         resolution       attendance,       the viewer is  (viewer)
                                   marks,            R3             
                                   enrollment,                      
                                   completion,                      
                                   certificates and                 
                                   passport entries                 
                                   (who, what, when,                
                                   old, new).                       
                                   BRQ-19.2 Admin                   
                                   views and filters                
                                   the log by user,                 
                                   entity and date.                 
                                   BRQ-19.3 Log                     
                                   entries cannot be                
                                   edited or deleted                

  F20 Training    Evidence for     BRQ-20.1 Compare  F8 reports,    Could
  Outcome         management on    completion rate,  F10, F13 for   
  Analytics       which courses    average score and placement data 
                  and batches work attendance across                
                                   courses and                      
                                   batches. BRQ-20.2                
                                   Track competency                 
                                   achievement rates                
                                   per course.                      
                                   BRQ-20.3 Record                  
                                   and report                       
                                   employment /                     
                                   placement                        
                                   outcomes per                     
                                   course                           
  --------------------------------------------------------------------------------

**Analysis notes.**

-   F17 is the highest-risk feature: it adds external cost, content
    preparation and answer-quality testing. Keep it strictly to approved
    materials and treat it as optional.

-   F19 logging is not optional --- the core business rules (BR-06,
    BR-12) already require it in R1. Only the viewer screen is an
    enhancement.

-   F16 is cheap to prepare for (externalize all UI strings from day
    one) but costly to complete (translation and review). Prepare in R1,
    translate in R3.

## 10. Business rules

The system, not individual users, enforces these rules; every threshold
below is a configurable setting, not hard-coded.

### 10.1 Core rules (from v2.1)

  -----------------------------------------------------------------------
  ID                                  Rule
  ----------------------------------- -----------------------------------
  BR-01                               One active enrollment per student
                                      per training cycle; duplicates
                                      rejected

  BR-02                               Enrollment accepted only while the
                                      course\'s window is open

  BR-03                               A batch never exceeds capacity;
                                      excess approved students are
                                      waitlisted

  BR-04                               Allocation honours preference rank
                                      first, then submission time;
                                      academic marks are never used
                                      (amended 2026-11-05)

  BR-05                               Trainers act only on batches
                                      assigned to them

  BR-06                               Attendance only for scheduled
                                      sessions; editable for 48 hours
                                      from the first marking or the
                                      session's end, whichever comes
                                      first, then Admin only with a
                                      reason, logged (amended v1.1)

  BR-07                               Marks between 0 and the
                                      assessment\'s maximum

  BR-08                               Attendance % = sessions attended ÷
                                      sessions conducted × 100, two
                                      decimals

  BR-09                               Completion requires attendance ≥
                                      75%, every session that has ended
                                      marked, all mandatory assessments
                                      recorded, aggregate ≥ 40% and a
                                      trainer recommendation (amended
                                      v1.1)

  BR-10                               Certificate only after Admin
                                      approval; unique, non-guessable ID

  BR-11                               Grades: A ≥ 85%, B 70--84.99%, C
                                      55--69.99%, D 40--54.99%, Not
                                      Completed \< 40%

  BR-12                               Every change to attendance, marks,
                                      enrollment or completion status is
                                      audit-logged (who, what, when, old,
                                      new)
  -----------------------------------------------------------------------

### 10.2 New rules for unique features

  -----------------------------------------------------------------------
  ID                      Rule                    Feature
  ----------------------- ----------------------- -----------------------
  BR-13                   A competency is         F10, F12
                          verified only when the  
                          student reaches the     
                          required level and an   
                          assigned trainer        
                          confirms it             

  BR-14                   Verified passport       F10, F19
                          entries are never       
                          deleted; Admin may      
                          revoke with a reason,   
                          logged                  

  BR-15                   Public passport and     F10, F15
                          certificate pages show  
                          no marks, attendance or 
                          contact details         

  BR-16                   Risk flags: Medium if   F11
                          attendance \< 80%, 3    
                          consecutive absences or 
                          any assessment \< 50%;  
                          High if attendance \<   
                          75%, projected          
                          aggregate \< 40% or a   
                          15-point drop between   
                          assessments             

  BR-17                   A flag closes after     F11
                          triggers clear for 7    
                          days; an unresolved     
                          High flag escalates to  
                          Admin after 14 days     

  BR-18                   Competency gap =        F12
                          required level −        
                          demonstrated level,     
                          minimum 0; a gap on a   
                          mandatory competency    
                          raises an F11 flag      

  BR-19                   Certificate IDs are     F15
                          random, at least 12
                          characters; revoked or
                          superseded certificates
                          keep their record and
                          show their status; a
                          revoked certificate may
                          be reissued under a new
                          ID (amended v1.1)

  BR-20                   No trainer or venue may F14
                          be booked into two
                          overlapping sessions; a
                          session naming no
                          trainer counts as
                          taught by its batch's
                          trainers (amended v1.1)

  BR-21                   The AI assistant        F17
                          answers only from       
                          approved materials and  
                          cites the source;       
                          otherwise it declines   

  BR-22                   Opportunity match % =   F13
                          verified required       
                          competencies ÷ total    
                          required competencies × 
                          100                     
  -----------------------------------------------------------------------

### 10.3 Rules added in v1.1

Six rules added after release. Like the others, the system enforces them and their thresholds are settings.

  -----------------------------------------------------------------------
  ID                      Rule                    Feature
  ----------------------- ----------------------- -----------------------
  BR-23                   A student may not be    F3, F4
                          approved for, or placed
                          in, two trainings whose
                          dates overlap

  BR-24                   A batch runs within its F2, F4
                          training cycle's dates;
                          an enrollment window
                          closes by the end of
                          its cycle

  BR-25                   A batch closes only     F4
                          after its end date and
                          when no student is
                          still in training; a
                          closed batch takes no
                          attendance, marks,
                          sessions or students

  BR-26                   A student withdrawn     F4, F5
                          from training keeps
                          their records but holds
                          no seat and is not
                          marked, assessed or
                          risk-checked; the
                          reason is recorded and
                          shown to them

  BR-27                   Passwords have at least F1
                          8 characters with a
                          letter and a digit; a
                          password set by an
                          admin must be changed
                          at the next sign-in;
                          every failed sign-in
                          gets the same answer

  BR-28                   A planned or running    F4, F5
                          batch keeps at least
                          one active trainer
  -----------------------------------------------------------------------

## 11. Non-functional requirements

NFR-01 to NFR-08 carry over from v2.1; NFR-09 to NFR-14 are added by the
unique features.

  -----------------------------------------------------------------------
  ID                      Category                Requirement
  ----------------------- ----------------------- -----------------------
  NFR-01                  Security                Passwords hashed
                                                  (bcrypt); JWT tokens
                                                  with expiry;
                                                  authorization checked
                                                  on the server for every
                                                  request

  NFR-02                  Security                Server-side input
                                                  validation;
                                                  parameterized queries /
                                                  ORM; output escaped
                                                  against XSS

  NFR-03                  Performance             Common pages and APIs
                                                  respond within 2 s for
                                                  100 concurrent users

  NFR-04                  Usability               Responsive on desktop
                                                  and mobile; each core
                                                  task within three
                                                  clicks of the dashboard

  NFR-05                  Reliability             Status-changing
                                                  operations run in
                                                  database transactions

  NFR-06                  Auditability            Sensitive changes
                                                  logged immutably
                                                  (BR-12)

  NFR-07                  Maintainability         Modular code per
                                                  module; README and API
                                                  documentation kept
                                                  current

  NFR-08                  Privacy                 Users see only
                                                  authorized data; public
                                                  pages expose minimal
                                                  details

  NFR-09                  Public access           Verification and shared
                                                  passport pages load
                                                  within 3 s on mobile,
                                                  need no login, and are
                                                  rate-limited

  NFR-10                  Low bandwidth           Core student pages
                                                  under 500 KB on first
                                                  load; usable on a 3G
                                                  connection

  NFR-11                  Localization            All UI strings stored
                                                  outside code from R1 so
                                                  Odia and Hindi can be
                                                  added without code
                                                  changes; Unicode fonts
                                                  for Odia script

  NFR-12                  Accessibility           Keyboard navigation,
                                                  labelled form fields
                                                  and sufficient contrast
                                                  (WCAG 2.1 AA as goal)

  NFR-13                  AI safety and cost      AI assistant limited to
                                                  approved materials,
                                                  monthly usage cap, no
                                                  student personal data
                                                  sent to the AI provider

  NFR-14                  Storage                 Evidence uploads
                                                  limited to images, PDF
                                                  and video links;
                                                  maximum 10 MB per file;
                                                  stored outside the
                                                  database
  -----------------------------------------------------------------------

## 12. Data and reporting requirements

The 17 entities in v2.1 cover the core workflow; the unique features
need 9 more, all linked to existing Student, Course, Batch and
Assessment records.

### 12.1 New business data

  -----------------------------------------------------------------------
  Entity                  Holds                   Used by
  ----------------------- ----------------------- -----------------------
  Competency              Course, code, title,    F10, F12, F13
                          type (theory /          
                          practical), required    
                          level, mandatory flag   

  AssessmentCompetency    Which assessments       F12
                          evidence which          
                          competency              

  CompetencyRating        Student, competency,    F10, F12
                          level achieved,         
                          trainer, date, verified 
                          flag                    

  PassportShare           Student, share token,   F10
                          created, expires,       
                          revoked                 

  RiskFlag                Student, batch, level,  F11
                          trigger reasons,        
                          opened, closed,         
                          escalated               

  InterventionAction      Flag, action type,      F11
                          owner, due date,        
                          outcome                 

  LearningResource        Competency, title,      F12, F17
                          type, link, approved by 

  Opportunity / JobRole   Title, type             F13
                          (internship,            
                          apprenticeship, job),   
                          partner, required       
                          competencies, closing   
                          date                    

  PracticalEvidence       Assessment result, file F18
                          or link, rubric         
                          criteria scores,        
                          uploaded by             
  -----------------------------------------------------------------------

The Certificate entity gains status (Valid, Revoked, Superseded),
revoked_reason and verification_count for F15.

### 12.2 Reports

  -----------------------------------------------------------------------
  Report            Audience          Contents          Release
  ----------------- ----------------- ----------------- -----------------
  Student           Student, Admin    Attendance %,     R1
  performance                         assessment        
  report (PDF)                        results,          
                                      aggregate, grade, 
                                      trainer remarks   

  Batch report      Trainer, Admin    Attendance and    R1
                                      results per       
                                      student,          
                                      completion status 

  Course report     Admin             Completion rate,  R1
                                      grade             
                                      distribution      
                                      across batches    

  Skill Passport    Student, employer Verified          R2
  (web + PDF)                         competencies,     
                                      levels,           
                                      certificates      

  At-risk students  Trainer, Admin    Open flags by     R2
                                      level, reason,    
                                      action and age    

  Competency gap /  Student, Trainer  Gaps per student; R2
  heatmap                             batch competency  
                                      coverage          

  Outcome analytics Admin, management Cross-course      R3
                                      comparison,       
                                      competency        
                                      achievement,      
                                      placement         
                                      outcomes          
  -----------------------------------------------------------------------

All tabular reports export to CSV; student-facing documents export to
PDF.

## 13. Assumptions, constraints and dependencies

**Assumptions**

-   Student, trainer and course master data can be seeded or entered by
    Administration.

-   Each student is enrolled in only one vocational course per training
    cycle.

-   One institution, one deployment.

-   In-app notifications are enough; email and SMS are optional.

-   Trainers will define 8--15 competencies per course and rate students
    against them (needed for F10--F12).

-   Admin will curate the learning resources and materials that F12 and
    F17 draw on.

**Constraints**

-   Two developers, one academic semester (about 12 weeks).

-   Free-tier hosting and database; limited budget for any paid AI API.

-   Stack fixed in v2.1: React, Node.js / Express, PostgreSQL, Prisma,
    PDFKit / Puppeteer, qrcode.

**Dependencies**

  -----------------------------------------------------------------------
  Dependency              Needed for              Owner
  ----------------------- ----------------------- -----------------------
  Competency lists for at F10, F12, F13           Team with a trainer or
  least 2 demo courses                            guide

  Public URL for the      F15 QR codes, shared    Team
  deployed app            passports               

  Native Odia and Hindi   F16                     Team (volunteers)
  reviewers                                       

  LLM API key with        F17                     Guide approval
  spending cap                                    

  File storage (cloud     F18 evidence            Team
  bucket or server disk)                          

  Sample opportunities    F13                     Admin / placement cell
  from the placement cell                         
  -----------------------------------------------------------------------

## 14. Risks and mitigations

Scope growth is the biggest risk: 20 features for two people in 12 weeks
only works if the core workflow is finished before any innovation
starts.

  -----------------------------------------------------------------------
  Risk              Prob.             Impact            Mitigation
  ----------------- ----------------- ----------------- -----------------
  Scope grows past  High              High              Freeze R1 scope
  what two people                                       after week 2; R2
  can deliver                                           starts only after
                                                        one student
                                                        completes the
                                                        full workflow; R3
                                                        is stretch only

  Competency model  Med               High              Define
  not defined in                                        competencies for
  time                                                  2 demo courses in
                                                        weeks 1--2; use
                                                        seed data

  Risk-flag rules   Med               Med               Make thresholds
  produce too many                                      configurable;
  false alarms                                          tune with demo
                                                        data; show the
                                                        reason for every
                                                        flag

  Shared passport   Low               High              Show minimal
  or verification                                       fields only
  page leaks                                            (BR-15); random
  personal data                                         tokens; rate
                                                        limiting;
                                                        security test
                                                        cases

  QR links break    Med               Med               Use a stable
  when the server                                       configured base
  URL changes                                           URL; deploy early
                                                        in week 3

  AI assistant      Med               High              Restrict to
  gives wrong or                                        approved
  off-topic answers                                     materials with
                                                        citations;
                                                        decline
                                                        otherwise; keep
                                                        F17 optional

  AI API cost       Low               Med               Monthly cap;
  exceeds budget                                        cache common
                                                        answers; disable
                                                        when the cap is
                                                        reached

  Translations      Med               Low               Externalize
  incomplete or                                         strings early;
  inaccurate                                            translate
                                                        student-facing
                                                        pages first;
                                                        native review

  Evidence uploads  Med               Med               10 MB limit;
  exhaust free                                          links for videos;
  storage                                               compress images

  Frontend /        Med               High              API contract
  backend                                               first; integrate
  integration                                           weekly
  problems                                              

  Insufficient      High              High              Write tests with
  testing time                                          each feature;
                                                        boundary tests
                                                        for every
                                                        threshold rule
  -----------------------------------------------------------------------

## 15. Prioritisation and roadmap

Build the full core workflow first (weeks 1--8), then the four
differentiators (weeks 9--10); everything else is stretch.

  -----------------------------------------------------------------------
  MoSCoW                              Features
  ----------------------------------- -----------------------------------
  Must                                F1--F9 core workflow; audit logging
                                      (F19 / BR-12)

  Should                              F10 Skill Passport, F11 Early
                                      Intervention, F12 Competency Gap
                                      Analyzer, F15 QR verification, F19
                                      audit log viewer

  Could                               F13 Career Matcher, F14 Smart
                                      Allocation, F16 Multilingual, F17
                                      AI Assistant, F18 Practical
                                      Evidence, F20 Outcome Analytics

  Won\'t (this version)               Payroll, LMS content hosting,
                                      biometric attendance, fee payment,
                                      native mobile apps
  -----------------------------------------------------------------------

release roadmap · 3 releases, 2 gates

Gate 1 keeps the v2.1 rule of thumb: no Should or Could work starts
until one student travels the full Must workflow in the deployed build.
To make R2 fit in two weeks, the competency tables (Section 12.1) are
created in week 3 with the rest of the schema, and UI strings are
externalized from the start for F16.

## 16. Traceability and sign-off

Each business problem maps to an objective, the requirements that meet
it and the tests that prove it; existing TC IDs come from v2.1 and new
TCs are to be written.

  ---------------------------------------------------------------------------------
  Problem          Objective      Business          Rules           Test cases
                                  requirements                      
  ---------------- -------------- ----------------- --------------- ---------------
  P1 Manual        BO-3           BRQ-3.1--3.4,     BR-01--BR-04,   TC-03--TC-07
  allocation                      BRQ-4.1--4.4,     BR-20           
                                  BRQ-14.x                          

  P2 Scattered     BO-1           BRQ-5.1--5.3,     BR-05--BR-08,   TC-08--TC-12
  records                         BRQ-6.1--6.4      BR-11           

  P3 No student    BO-4           BRQ-5.3, BRQ-9.3  BR-08           TC-09
  visibility                                                        

  P4 Unverifiable  BO-5           BRQ-7.1--7.3,     BR-09, BR-10,   TC-13, TC-14,
  certificates                    BRQ-15.1--15.5    BR-19           TC-16--TC-18,
                                                                    new TC-20--22

  P5 No change     BO-8           BRQ-19.1--19.3    BR-12, BR-14    TC-19
  history                                                           

  P6 Skills not    BO-7           BRQ-C.1--C.2,     BR-13--BR-15,   new TC-23--26
  visible to                      BRQ-10.1--10.4,   BR-22           
  employers                       BRQ-13.x,                         
                                  BRQ-18.x                          

  P7 Late          BO-6           BRQ-11.1--11.5,   BR-16--BR-18    new TC-27--31
  identification                  BRQ-12.1--12.4                    
  of struggling                                                     
  students                                                          

  P8 Language and  BO-1           BRQ-16.1--16.4    ---             new TC-32--33
  bandwidth                                                         
  barriers                                                          

  Role security    BO-2           BRQ-1.1--1.3      BR-05           TC-01, TC-02,
                                                                    TC-15

  P9 Training end  BO-3, BO-4     BRQ-1.4, BRQ-2.4, BR-23--BR-28    Automated
  not managed                     BRQ-2.5, BRQ-3.5,                 tests, listed
  (v1.1)                          BRQ-4.5, BRQ-4.6                  in TRACEABILITY

  P10 Steps done   BO-3, BO-6     BRQ-1.5, BRQ-3.6, BR-25, BR-04    Automated
  by hand (v1.2)                  BRQ-4.7, BRQ-4.8,                 tests, listed
                                  BRQ-7.4, BRQ-9.5,                 in TRACEABILITY
                                  BRQ-9.6,
                                  BRQ-20.4,
                                  BRQ-20.5
  ---------------------------------------------------------------------------------

**Suggested new boundary tests.** Attendance 79.99% / 80.00% (Medium
flag), 74.99% / 75.00% (High flag); competency level equal to required
(no gap) and one below (gap 1); revoked certificate shows \"Revoked\";
expired passport link shows \"Link no longer active\".

### Sign-off

  -----------------------------------------------------------------------
  Role              Name              Decision          Date
  ----------------- ----------------- ----------------- -----------------
  Project guide                                         

  Team member 1                                         

  Team member 2                                         
  -----------------------------------------------------------------------
