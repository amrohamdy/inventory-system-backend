-- Phase 6 Migration: Inter-Store Transfers + Breakage documentSubtype
-- Migration: 20260228030000_phase6_transfers_breakage_subtype

-- New enum
CREATE TYPE "TransferStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED', 'REJECTED'
);

-- StoreTransfer
CREATE TABLE "store_transfers" (
    "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId"        UUID NOT NULL REFERENCES "tenants"("id"),
    "transferNo"      TEXT NOT NULL,
    "sourceLocationId" UUID NOT NULL REFERENCES "locations"("id"),
    "destLocationId"  UUID NOT NULL REFERENCES "locations"("id"),
    "requestedBy"     UUID NOT NULL REFERENCES "users"("id"),
    "approvedBy"      UUID REFERENCES "users"("id"),
    "rejectedBy"      UUID REFERENCES "users"("id"),
    "receivedBy"      UUID REFERENCES "users"("id"),
    "transferDate"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "requiredBy"      TIMESTAMPTZ,
    "status"          "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "reason"          TEXT,
    "rejectionReason" TEXT,
    "notes"           TEXT,
    "approvedAt"      TIMESTAMPTZ,
    "dispatchedAt"    TIMESTAMPTZ,
    "receivedAt"      TIMESTAMPTZ,
    "closedAt"        TIMESTAMPTZ,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "store_transfers_tenantId_transferNo_key" UNIQUE ("tenantId", "transferNo")
);
CREATE INDEX "store_transfers_tenantId_idx"             ON "store_transfers"("tenantId");
CREATE INDEX "store_transfers_tenantId_status_idx"      ON "store_transfers"("tenantId", "status");
CREATE INDEX "store_transfers_tenantId_source_idx"      ON "store_transfers"("tenantId", "sourceLocationId");
CREATE INDEX "store_transfers_tenantId_dest_idx"        ON "store_transfers"("tenantId", "destLocationId");

-- StoreTransferLine
CREATE TABLE "store_transfer_lines" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "transferId"   UUID NOT NULL REFERENCES "store_transfers"("id") ON DELETE CASCADE,
    "itemId"       UUID NOT NULL REFERENCES "items"("id"),
    "uomId"        UUID NOT NULL REFERENCES "units"("id"),
    "requestedQty" DECIMAL(15,4) NOT NULL,
    "receivedQty"  DECIMAL(15,4),          -- Confirmed at receipt (may differ for partials)
    "unitCost"     DECIMAL(15,4) DEFAULT 0, -- WAC at time of posting
    "totalValue"   DECIMAL(15,4) DEFAULT 0,
    "notes"        TEXT
);
CREATE INDEX "store_transfer_lines_transferId_idx" ON "store_transfer_lines"("transferId");

-- Breakage enhancement: add documentSubtype (BREAKAGE, WASTAGE, EXPIRY, THEFT)
ALTER TABLE "movement_documents" ADD COLUMN IF NOT EXISTS "documentSubtype" TEXT;
