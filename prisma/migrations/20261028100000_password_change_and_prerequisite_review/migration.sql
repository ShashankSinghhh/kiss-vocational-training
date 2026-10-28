-- A3: an admin-set password (new account or reset) must be replaced at first sign-in.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- D2: whether a course's prerequisites need a person to check them before automatic approval.
ALTER TABLE "courses" ADD COLUMN "prerequisites_need_review" BOOLEAN NOT NULL DEFAULT true;
