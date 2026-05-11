CREATE TABLE IF NOT EXISTS "itineraries" (
  "id" UUID PRIMARY KEY,
  "userId" VARCHAR(36) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "dateRange" VARCHAR(100),
  "duration" VARCHAR(50),
  "destinations" VARCHAR[] NOT NULL DEFAULT ARRAY[]::VARCHAR[],
  "flights" INTEGER NOT NULL DEFAULT 0,
  "hotels" INTEGER NOT NULL DEFAULT 0,
  "activities" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'Planned',
  "aiSuggestion" TEXT,
  "details" TEXT,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "itineraries_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "itineraries_userId_idx" ON "itineraries" ("userId");

