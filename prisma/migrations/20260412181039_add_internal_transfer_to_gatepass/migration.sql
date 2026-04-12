-- AlterTable
ALTER TABLE "get_passes" ADD COLUMN     "isInternalTransfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnDate" TIMESTAMP(3),
ADD COLUMN     "targetTenantId" UUID;

-- AlterTable
ALTER TABLE "password_resets" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "system_notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_notifications_tenantId_userId_idx" ON "system_notifications"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "system_notifications_userId_readAt_idx" ON "system_notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "get_passes_targetTenantId_idx" ON "get_passes"("targetTenantId");

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_notifications" ADD CONSTRAINT "system_notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_notifications" ADD CONSTRAINT "system_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
