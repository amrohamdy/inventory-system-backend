-- Replace prior password_resets shape (user_id / otp_hash / created_at) with id, email, otp, expiresAt.
DROP TABLE IF EXISTS "password_resets";

CREATE TABLE "password_resets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "password_resets_email_idx" ON "password_resets"("email");
