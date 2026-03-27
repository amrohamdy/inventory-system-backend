-- Phase 5 Migration: Store Requisition + Controlled Issue Gate
-- Migration: 20260228020000_phase5_store_requisition_issue

-- New enums
CREATE TYPE "RequisitionStatus" AS ENUM (
    'DRAFT', 'SUBMITTED', 'APPROVED',
    'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CLOSED', 'REJECTED'
);

CREATE TYPE "IssueStatus" AS ENUM ('DRAFT', 'POSTED');

-- Extend ApprovalRequestType
ALTER TYPE "ApprovalRequestType" ADD VALUE IF NOT EXISTS 'STORE_REQUISITION';

-- StoreRequisition
CREATE TABLE "store_requisitions" (
    "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId"        UUID NOT NULL REFERENCES "tenants"("id"),
    "requisitionNo"   TEXT NOT NULL,
    "departmentName"  TEXT NOT NULL,
    "locationId"      UUID NOT NULL REFERENCES "locations"("id"),
    "requestedBy"     UUID NOT NULL REFERENCES "users"("id"),
    "approvedBy"      UUID REFERENCES "users"("id"),
    "rejectedBy"      UUID REFERENCES "users"("id"),
    "requestDate"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "requiredBy"      TIMESTAMPTZ,
    "status"          "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks"         TEXT,
    "rejectionReason" TEXT,
    "approvedAt"      TIMESTAMPTZ,
    "fullyIssuedAt"   TIMESTAMPTZ,
    "closedAt"        TIMESTAMPTZ,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "store_requisitions_tenantId_requisitionNo_key" UNIQUE ("tenantId", "requisitionNo")
);
CREATE INDEX "store_requisitions_tenantId_idx"          ON "store_requisitions"("tenantId");
CREATE INDEX "store_requisitions_tenantId_status_idx"   ON "store_requisitions"("tenantId", "status");
CREATE INDEX "store_requisitions_tenantId_locationId_idx" ON "store_requisitions"("tenantId", "locationId");

-- StoreRequisitionLine
CREATE TABLE "store_requisition_lines" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "requisitionId"  UUID NOT NULL REFERENCES "store_requisitions"("id") ON DELETE CASCADE,
    "itemId"         UUID NOT NULL REFERENCES "items"("id"),
    "uomId"          UUID NOT NULL REFERENCES "units"("id"),
    "requestedQty"   DECIMAL(15,4) NOT NULL,
    "totalIssuedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "notes"          TEXT
);
CREATE INDEX "store_requisition_lines_requisitionId_idx" ON "store_requisition_lines"("requisitionId");

-- StoreIssue
CREATE TABLE "store_issues" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenantId"      UUID NOT NULL REFERENCES "tenants"("id"),
    "issueNo"       TEXT NOT NULL,
    "requisitionId" UUID NOT NULL REFERENCES "store_requisitions"("id"),
    "issueDate"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "issuedBy"      UUID NOT NULL REFERENCES "users"("id"),
    "status"        "IssueStatus" NOT NULL DEFAULT 'DRAFT',
    "notes"         TEXT,
    "attachmentUrl" TEXT,
    "postedAt"      TIMESTAMPTZ,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "store_issues_tenantId_issueNo_key" UNIQUE ("tenantId", "issueNo")
);
CREATE INDEX "store_issues_tenantId_idx"             ON "store_issues"("tenantId");
CREATE INDEX "store_issues_tenantId_requisitionId_idx" ON "store_issues"("tenantId", "requisitionId");

-- StoreIssueLine
CREATE TABLE "store_issue_lines" (
    "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "issueId"           UUID NOT NULL REFERENCES "store_issues"("id") ON DELETE CASCADE,
    "requisitionLineId" UUID NOT NULL REFERENCES "store_requisition_lines"("id"),
    "itemId"            UUID NOT NULL REFERENCES "items"("id"),
    "uomId"             UUID NOT NULL REFERENCES "units"("id"),
    "issuedQty"         DECIMAL(15,4) NOT NULL,
    "unitCost"          DECIMAL(15,4) NOT NULL DEFAULT 0,
    "totalValue"        DECIMAL(15,4) NOT NULL DEFAULT 0
);
CREATE INDEX "store_issue_lines_issueId_idx"           ON "store_issue_lines"("issueId");
CREATE INDEX "store_issue_lines_requisitionLineId_idx" ON "store_issue_lines"("requisitionLineId");
