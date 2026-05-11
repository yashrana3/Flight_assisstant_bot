CREATE TABLE IF NOT EXISTS "loyalty_programs" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "airline_name" TEXT NOT NULL,
  "program_name" TEXT NOT NULL,
  "member_number" TEXT NOT NULL,
  "member_number_last4" TEXT,
  "current_miles" INTEGER NOT NULL DEFAULT 0,
  "tier_status" TEXT NOT NULL,
  "next_tier" TEXT NOT NULL,
  "miles_to_next_tier" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "loyalty_programs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "loyalty_programs_user_id_idx" ON "loyalty_programs" ("user_id");
