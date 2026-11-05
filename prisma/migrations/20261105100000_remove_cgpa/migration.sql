-- Vocational training is open to every student: academic CGPA is no longer recorded or used.
ALTER TABLE "students" DROP COLUMN "cgpa";
DELETE FROM "settings" WHERE "key" = 'enrollment.autoApproveMinCgpa';
UPDATE "settings" SET "value" = '"SUBMISSION_TIME"'::jsonb WHERE "key" = 'allocation.priorityRule';
