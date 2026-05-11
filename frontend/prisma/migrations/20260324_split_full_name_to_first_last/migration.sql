-- Split users.fullName into firstName + lastName.
-- Requirement: keep only first word in firstName and let users fill lastName later.

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "firstName" TEXT,
ADD COLUMN IF NOT EXISTS "lastName" TEXT;

UPDATE "users"
SET "firstName" = NULLIF(split_part(trim(coalesce("fullName", '')), ' ', 1), '')
WHERE "firstName" IS NULL;

-- Intentionally leave lastName empty so users can provide it manually.
UPDATE "users"
SET "lastName" = NULL
WHERE "lastName" IS NULL;

ALTER TABLE "users"
DROP COLUMN IF EXISTS "fullName";
