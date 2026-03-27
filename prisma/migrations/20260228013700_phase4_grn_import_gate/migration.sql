-- Phase 4: FutureLog GRN Import & Approval Gate
-- Migration: 20260228013700_phase4_grn_import_gate

-- ─── Enums ─────────────────────────────────────────────────────────────────

ALTER TYPE "ApprovalRequestType" ADD VALUE IF NOT EXISTS 'GRN_IMPORT';

CREATE TYPE "GrnStatus" AS ENUM (
    'DRAFT',
    'VALIDATED',
    'PENDING_APPROVAL',
    'APPROVED',
    'POSTED',
    'REJECTED'
);

-- ─── GRN Import Header ──────────────────────────────────────────────────────

CREATE TABLE "grn_imports" (
    "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"           UUID         NOT NULL,
    "grnNumber"          TEXT         NOT NULL,
    "vendorId"           UUID,                             -- nullable until vendor mapped
    "vendorNameSnapshot" TEXT         NOT NULL,             -- raw name from FutureLog
    "locationId"         UUID         NOT NULL,
    "receivingDate"      TIMESTAMP(3) NOT NULL,
    "pdfAttachmentUrl"   TEXT         NOT NULL,
    "status"             "GrnStatus"  NOT NULL DEFAULT 'DRAFT',
    "rejectionReason"    TEXT,
    "notes"              TEXT,
    "importedBy"         UUID         NOT NULL,
    "approvedBy"         UUID,
    "rejectedBy"         UUID,
    "postedAt"           TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grn_imports_pkey" PRIMARY KEY ("id")
);

-- ─── GRN Lines ──────────────────────────────────────────────────────────────

CREATE TABLE "grn_lines" (
    "id"                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    "grnImportId"          UUID           NOT NULL,
    "futurelogItemCode"    TEXT           NOT NULL,
    "futurelogDescription" TEXT           NOT NULL,
    "futurelogUom"         TEXT           NOT NULL,
    "orderedQty"           DECIMAL(15, 4) NOT NULL,        -- reference only, NEVER posted
    "receivedQty"          DECIMAL(15, 4) NOT NULL,        -- only qty posted to ledger
    "unitPrice"            DECIMAL(15, 4) NOT NULL,
    "internalItemId"       UUID,                           -- null until mapped
    "internalUomId"        UUID,                           -- null until mapped
    "conversionFactor"     DECIMAL(15, 6) NOT NULL DEFAULT 1,
    "qtyInBaseUnit"        DECIMAL(15, 4) NOT NULL DEFAULT 0, -- receivedQty × conversionFactor
    "isMapped"             BOOLEAN        NOT NULL DEFAULT false,

    CONSTRAINT "grn_lines_pkey" PRIMARY KEY ("id")
);

-- ─── Item Mapping ───────────────────────────────────────────────────────────

CREATE TABLE "item_mappings" (
    "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"          UUID         NOT NULL,
    "futurelogItemCode" TEXT         NOT NULL,
    "futurelogItemName" TEXT         NOT NULL,
    "internalItemId"    UUID         NOT NULL,
    "createdBy"         UUID         NOT NULL,
    "updatedBy"         UUID         NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_mappings_pkey" PRIMARY KEY ("id")
);

-- ─── UOM Mapping ────────────────────────────────────────────────────────────

CREATE TABLE "uom_mappings" (
    "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"         UUID           NOT NULL,
    "futurelogUom"     TEXT           NOT NULL,
    "internalUomId"    UUID           NOT NULL,
    "conversionFactor" DECIMAL(15, 6) NOT NULL DEFAULT 1,
    "createdBy"        UUID           NOT NULL,
    "updatedBy"        UUID           NOT NULL,
    "createdAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uom_mappings_pkey" PRIMARY KEY ("id")
);

-- ─── Vendor Mapping ─────────────────────────────────────────────────────────

CREATE TABLE "vendor_mappings" (
    "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"            UUID         NOT NULL,
    "futurelogVendorName" TEXT         NOT NULL,
    "internalSupplierId"  UUID         NOT NULL,
    "createdBy"           UUID         NOT NULL,
    "updatedBy"           UUID         NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_mappings_pkey" PRIMARY KEY ("id")
);

-- ─── Unique Constraints ─────────────────────────────────────────────────────

ALTER TABLE "grn_imports"    ADD CONSTRAINT "grn_imports_tenantId_grnNumber_key"          UNIQUE ("tenantId", "grnNumber");
ALTER TABLE "item_mappings"  ADD CONSTRAINT "item_mappings_tenantId_futurelogItemCode_key" UNIQUE ("tenantId", "futurelogItemCode");
ALTER TABLE "uom_mappings"   ADD CONSTRAINT "uom_mappings_tenantId_futurelogUom_key"       UNIQUE ("tenantId", "futurelogUom");
ALTER TABLE "vendor_mappings" ADD CONSTRAINT "vendor_mappings_tenantId_futurelogVendorName_key" UNIQUE ("tenantId", "futurelogVendorName");

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX "grn_imports_tenantId_status_idx"     ON "grn_imports" ("tenantId", "status");
CREATE INDEX "grn_imports_tenantId_vendorId_idx"   ON "grn_imports" ("tenantId", "vendorId");
CREATE INDEX "grn_imports_tenantId_locationId_idx" ON "grn_imports" ("tenantId", "locationId");
CREATE INDEX "grn_lines_grnImportId_idx"           ON "grn_lines" ("grnImportId");
CREATE INDEX "grn_lines_grnImportId_isMapped_idx"  ON "grn_lines" ("grnImportId", "isMapped");
CREATE INDEX "item_mappings_tenantId_idx"          ON "item_mappings" ("tenantId");
CREATE INDEX "uom_mappings_tenantId_idx"           ON "uom_mappings" ("tenantId");
CREATE INDEX "vendor_mappings_tenantId_idx"        ON "vendor_mappings" ("tenantId");

-- ─── Foreign Keys ────────────────────────────────────────────────────────────

ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_tenantId_fkey"    FOREIGN KEY ("tenantId")   REFERENCES "tenants"("id")   ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_vendorId_fkey"    FOREIGN KEY ("vendorId")   REFERENCES "suppliers"("id") ON DELETE SET NULL  ON UPDATE CASCADE;
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_locationId_fkey"  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_importedBy_fkey"  FOREIGN KEY ("importedBy") REFERENCES "users"("id")     ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_approvedBy_fkey"  FOREIGN KEY ("approvedBy") REFERENCES "users"("id")     ON DELETE SET NULL  ON UPDATE CASCADE;
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_rejectedBy_fkey"  FOREIGN KEY ("rejectedBy") REFERENCES "users"("id")     ON DELETE SET NULL  ON UPDATE CASCADE;

ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grnImportId_fkey" FOREIGN KEY ("grnImportId") REFERENCES "grn_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_mappings"   ADD CONSTRAINT "item_mappings_tenantId_fkey"   FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "uom_mappings"    ADD CONSTRAINT "uom_mappings_tenantId_fkey"    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_mappings" ADD CONSTRAINT "vendor_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
