CREATE TABLE IF NOT EXISTS "document_vault_images" (
  "id" UUID PRIMARY KEY,
  "userId" VARCHAR(36) NOT NULL,
  "docType" VARCHAR(20) NOT NULL,
  "fileName" VARCHAR(255),
  "mimeType" VARCHAR(50),
  "imageBase64" TEXT NOT NULL,
  "createdAt" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_vault_images_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "document_vault_images_userId_idx"
  ON "document_vault_images" ("userId");

