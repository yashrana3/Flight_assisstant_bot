DO $$ BEGIN
  CREATE TYPE "LoyaltyActivityType" AS ENUM ('EARNED', 'REDEEMED', 'ADJUSTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "loyalty_activities" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "program_id" TEXT NOT NULL,
  "activity_date" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "description" TEXT NOT NULL,
  "activity_type" "LoyaltyActivityType" NOT NULL,
  "miles_change" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "loyalty_activities_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "loyalty_activities_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "loyalty_activities_user_id_idx" ON "loyalty_activities" ("user_id");
CREATE INDEX IF NOT EXISTS "loyalty_activities_program_id_idx" ON "loyalty_activities" ("program_id");
