-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TenantSubStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TenantAdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING_BALANCE', 'RECEIVE', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN', 'ADJUSTMENT', 'BREAKAGE', 'COUNT_ADJUSTMENT', 'TRANSFER', 'LOAN_WRITE_OFF', 'GET_PASS_OUT', 'GET_PASS_RETURN');

-- CreateEnum
CREATE TYPE "GetPassType" AS ENUM ('TEMPORARY', 'CATERING', 'PERMANENT');

-- CreateEnum
CREATE TYPE "GetPassStatus" AS ENUM ('DRAFT', 'PENDING_DEPT', 'PENDING_FINANCE', 'PENDING_SECURITY', 'APPROVED', 'OUT', 'PARTIALLY_RETURNED', 'RETURNED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GetPassLineStatus" AS ENUM ('PENDING', 'OUT', 'PARTIALLY_RETURNED', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'VOID', 'REJECTED');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('BASE', 'PURCHASE', 'ISSUE');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('MAIN_STORE', 'OUTLET_STORE', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "ApprovalRequestType" AS ENUM ('ADJUSTMENT', 'BREAKAGE', 'COUNT_ADJUSTMENT', 'GRN_IMPORT', 'STORE_REQUISITION', 'STOCK_REPORT', 'STORE_TRANSFER');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_DEPT', 'PENDING_FINANCE', 'PENDING_FINAL', 'APPROVED', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_DEPT', 'PENDING_FINANCE', 'PENDING_FINAL', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GrnStatus" AS ENUM ('DRAFT', 'VALIDATED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'VALIDATED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CountSessionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'POST', 'VOID', 'APPROVE', 'REJECT', 'IMPORT', 'LOGIN', 'LOGOUT', 'SUBMIT', 'CLOSE_PERIOD', 'REOPEN_PERIOD', 'LOCK_OB', 'COUNT_APPROVE', 'COUNT_REJECT');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('SUMMARY', 'DETAIL', 'BREAKAGE', 'OMC', 'TRANSFERS', 'AGING');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'starter',
    "logoUrl" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planType" "PlanType" NOT NULL DEFAULT 'BASIC',
    "subStatus" "TenantSubStatus" NOT NULL DEFAULT 'TRIAL',
    "adminStatus" "TenantAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "licenseStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "licenseEndDate" TIMESTAMP(3),
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "hasBranches" BOOLEAN NOT NULL DEFAULT false,
    "maxBranches" INTEGER NOT NULL DEFAULT 0,
    "parentId" UUID,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "department" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "permissionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "tenant_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departmentId" UUID,

    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "departmentId" UUID,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcategories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'MAIN_STORE',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "departmentId" UUID,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_categories" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "location_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_users" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "location_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_units" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "unitType" "UnitType" NOT NULL,
    "conversionRate" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "item_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" UUID,
    "subcategoryId" UUID,
    "supplierId" UUID,
    "barcode" TEXT,
    "unitPrice" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT,
    "defaultStoreId" UUID,
    "departmentId" UUID,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "reorderQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_ledger" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "qtyIn" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "qtyOut" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" UUID,
    "referenceNo" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalId" UUID,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "qtyOnHand" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "wacUnitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maxQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "minQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "reorderPoint" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("tenantId","itemId","locationId")
);

-- CreateTable
CREATE TABLE "movement_documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "documentNo" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceLocationId" UUID,
    "destLocationId" UUID,
    "documentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" UUID,
    "department" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "createdBy" UUID NOT NULL,
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movement_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movement_lines" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "unitId" UUID,
    "qtyRequested" DECIMAL(15,4) NOT NULL,
    "qtyInBaseUnit" DECIMAL(15,4) NOT NULL,
    "unitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "movement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requestType" "ApprovalRequestType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "documentId" UUID,
    "storeTransferId" UUID,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "requiredRoleId" UUID NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "actedBy" UUID,
    "actedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "warningRows" INTEGER NOT NULL DEFAULT 0,
    "columnMap" JSONB,
    "importedBy" UUID NOT NULL,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "mappedData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errors" JSONB,
    "warnings" JSONB,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "sessionNo" TEXT NOT NULL,
    "countDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalRequestId" UUID,
    "movementDocumentId" UUID,
    "postedAt" TIMESTAMP(3),
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "bookQty" DECIMAL(15,4) NOT NULL,
    "countedQty" DECIMAL(15,4),
    "varianceQty" DECIMAL(15,4),
    "wacUnitCost" DECIMAL(15,4) NOT NULL,
    "varianceValue" DECIMAL(15,4),
    "notes" TEXT,
    "qtyOnLoan" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_closes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_snapshots" (
    "id" UUID NOT NULL,
    "periodCloseId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "closingQty" DECIMAL(15,4) NOT NULL,
    "closingValue" DECIMAL(15,4) NOT NULL,
    "wacUnitCost" DECIMAL(15,4) NOT NULL,

    CONSTRAINT "period_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "changedBy" UUID NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "note" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_sequence" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "doc_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_imports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "vendorId" UUID,
    "vendorNameSnapshot" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "receivingDate" TIMESTAMP(3) NOT NULL,
    "pdfAttachmentUrl" TEXT NOT NULL,
    "status" "GrnStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "notes" TEXT,
    "importedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "rejectedBy" UUID,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grn_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_lines" (
    "id" UUID NOT NULL,
    "grnImportId" UUID NOT NULL,
    "futurelogItemCode" TEXT NOT NULL,
    "futurelogDescription" TEXT NOT NULL,
    "futurelogUom" TEXT NOT NULL,
    "orderedQty" DECIMAL(15,4) NOT NULL,
    "receivedQty" DECIMAL(15,4) NOT NULL,
    "unitPrice" DECIMAL(15,4) NOT NULL,
    "internalItemId" UUID,
    "internalUomId" UUID,
    "conversionFactor" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "qtyInBaseUnit" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "isMapped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "grn_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_mappings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "futurelogItemCode" TEXT NOT NULL,
    "futurelogItemName" TEXT NOT NULL,
    "internalItemId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uom_mappings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "futurelogUom" TEXT NOT NULL,
    "internalUomId" UUID NOT NULL,
    "conversionFactor" DECIMAL(15,6) NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uom_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_mappings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "futurelogVendorName" TEXT NOT NULL,
    "internalSupplierId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_requisitions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "requisitionNo" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "rejectedBy" UUID,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredBy" TIMESTAMP(3),
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fullyIssuedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_requisition_lines" (
    "id" UUID NOT NULL,
    "requisitionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "uomId" UUID NOT NULL,
    "requestedQty" DECIMAL(15,4) NOT NULL,
    "totalIssuedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "store_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_issues" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "issueNo" TEXT NOT NULL,
    "requisitionId" UUID NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedBy" UUID NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "attachmentUrl" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_issue_lines" (
    "id" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "requisitionLineId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "uomId" UUID NOT NULL,
    "issuedQty" DECIMAL(15,4) NOT NULL,
    "unitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "store_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "transferNo" TEXT NOT NULL,
    "sourceLocationId" UUID NOT NULL,
    "destLocationId" UUID NOT NULL,
    "requestedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "rejectedBy" UUID,
    "receivedBy" UUID,
    "transferDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requiredBy" TIMESTAMP(3),
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_transfer_lines" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "uomId" UUID NOT NULL,
    "requestedQty" DECIMAL(15,4) NOT NULL,
    "receivedQty" DECIMAL(15,4),
    "unitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "store_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planType" "PlanType" NOT NULL DEFAULT 'BASIC',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "maxStores" INTEGER NOT NULL DEFAULT 2,
    "maxDepartments" INTEGER NOT NULL DEFAULT 3,
    "maxMonthlyMovements" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_usage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "totalActiveStores" INTEGER NOT NULL DEFAULT 0,
    "movementsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "movementsResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storageBytes" BIGINT NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admin_logs" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetTenantId" UUID,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" UUID,
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "get_passes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "passNo" TEXT NOT NULL,
    "transferType" "GetPassType" NOT NULL,
    "departmentId" UUID,
    "borrowingEntity" TEXT NOT NULL,
    "expectedReturnDate" TIMESTAMP(3),
    "status" "GetPassStatus" NOT NULL DEFAULT 'DRAFT',
    "deptApprovedBy" UUID,
    "deptApprovedAt" TIMESTAMP(3),
    "financeApprovedBy" UUID,
    "financeApprovedAt" TIMESTAMP(3),
    "securityApprovedBy" UUID,
    "securityApprovedAt" TIMESTAMP(3),
    "checkedOutBy" UUID,
    "checkedOutAt" TIMESTAMP(3),
    "closedBy" UUID,
    "closedAt" TIMESTAMP(3),
    "reason" TEXT,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "get_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "get_pass_lines" (
    "id" UUID NOT NULL,
    "getPassId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "qty" DECIMAL(15,4) NOT NULL,
    "qtyReturned" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "conditionOut" TEXT,
    "status" "GetPassLineStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "get_pass_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "get_pass_returns" (
    "id" UUID NOT NULL,
    "getPassLineId" UUID NOT NULL,
    "qtyReturned" DECIMAL(15,4) NOT NULL,
    "conditionIn" TEXT,
    "returnDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registeredBy" UUID NOT NULL,
    "securityVerifiedBy" UUID,
    "notes" TEXT,

    CONSTRAINT "get_pass_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_stock_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reportNo" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'DRAFT',
    "dateGenerated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "approvalRequestId" UUID,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_stock_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_stock_report_lines" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "openingQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "openingValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "inwardQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "inwardValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "outwardQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "outwardValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "closingQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "closingValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "outOnPassQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "grnQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "grnValue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "breakages" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "saved_stock_report_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_stock_report_location_qtys" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "bookQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "countedQty" DECIMAL(15,4),
    "varianceQty" DECIMAL(15,4) NOT NULL DEFAULT 0,

    CONSTRAINT "saved_stock_report_location_qtys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "reportName" TEXT NOT NULL,
    "departmentId" UUID,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "data" JSONB NOT NULL,
    "generatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_parentId_idx" ON "tenants"("parentId");

-- CreateIndex
CREATE INDEX "tenants_hasBranches_idx" ON "tenants"("hasBranches");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "roles_tenantId_idx" ON "roles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "tenant_members_userId_idx" ON "tenant_members"("userId");

-- CreateIndex
CREATE INDEX "tenant_members_tenantId_idx" ON "tenant_members"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_members_tenantId_roleId_idx" ON "tenant_members"("tenantId", "roleId");

-- CreateIndex
CREATE INDEX "tenant_members_departmentId_idx" ON "tenant_members"("departmentId");

-- CreateIndex
CREATE INDEX "tenant_members_tenantId_departmentId_idx" ON "tenant_members"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_members_tenantId_userId_key" ON "tenant_members"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "categories_tenantId_idx" ON "categories"("tenantId");

-- CreateIndex
CREATE INDEX "categories_departmentId_idx" ON "categories"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_name_key" ON "categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "subcategories_tenantId_idx" ON "subcategories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "subcategories_tenantId_categoryId_name_key" ON "subcategories"("tenantId", "categoryId", "name");

-- CreateIndex
CREATE INDEX "departments_tenantId_idx" ON "departments"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_name_key" ON "departments"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_code_key" ON "departments"("tenantId", "code");

-- CreateIndex
CREATE INDEX "locations_tenantId_idx" ON "locations"("tenantId");

-- CreateIndex
CREATE INDEX "locations_departmentId_idx" ON "locations"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenantId_name_key" ON "locations"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "location_categories_locationId_categoryId_key" ON "location_categories"("locationId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "location_users_locationId_userId_key" ON "location_users"("locationId", "userId");

-- CreateIndex
CREATE INDEX "units_tenantId_idx" ON "units"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenantId_name_key" ON "units"("tenantId", "name");

-- CreateIndex
CREATE INDEX "item_units_tenantId_idx" ON "item_units"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "item_units_itemId_unitType_key" ON "item_units"("itemId", "unitType");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_name_key" ON "suppliers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "items_tenantId_idx" ON "items"("tenantId");

-- CreateIndex
CREATE INDEX "items_tenantId_categoryId_idx" ON "items"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "items_tenantId_departmentId_idx" ON "items"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "items_tenantId_name_key" ON "items"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "items_tenantId_code_key" ON "items"("tenantId", "code");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_itemId_idx" ON "inventory_ledger"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_locationId_idx" ON "inventory_ledger"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_createdAt_idx" ON "inventory_ledger"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_movementType_idx" ON "inventory_ledger"("tenantId", "movementType");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_movementType_createdAt_idx" ON "inventory_ledger"("tenantId", "movementType", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_locationId_itemId_idx" ON "inventory_ledger"("tenantId", "locationId", "itemId");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_locationId_itemId_createdAt_idx" ON "inventory_ledger"("tenantId", "locationId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_ledger_tenantId_referenceId_idx" ON "inventory_ledger"("tenantId", "referenceId");

-- CreateIndex
CREATE INDEX "stock_balances_tenantId_idx" ON "stock_balances"("tenantId");

-- CreateIndex
CREATE INDEX "stock_balances_tenantId_locationId_idx" ON "stock_balances"("tenantId", "locationId");

-- CreateIndex
CREATE INDEX "stock_balances_tenantId_itemId_idx" ON "stock_balances"("tenantId", "itemId");

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_movementType_idx" ON "movement_documents"("tenantId", "movementType");

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_movementType_documentDate_idx" ON "movement_documents"("tenantId", "movementType", "documentDate");

-- CreateIndex
CREATE INDEX "movement_documents_tenantId_status_idx" ON "movement_documents"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "movement_documents_tenantId_documentNo_key" ON "movement_documents"("tenantId", "documentNo");

-- CreateIndex
CREATE INDEX "movement_lines_documentId_idx" ON "movement_lines"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_documentId_key" ON "approval_requests"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_storeTransferId_key" ON "approval_requests"("storeTransferId");

-- CreateIndex
CREATE INDEX "approval_requests_tenantId_status_idx" ON "approval_requests"("tenantId", "status");

-- CreateIndex
CREATE INDEX "approval_steps_requiredRoleId_idx" ON "approval_steps"("requiredRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_steps_requestId_stepNumber_key" ON "approval_steps"("requestId", "stepNumber");

-- CreateIndex
CREATE INDEX "import_sessions_tenantId_idx" ON "import_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "import_rows_sessionId_idx" ON "import_rows"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_sessions_approvalRequestId_key" ON "stock_count_sessions"("approvalRequestId");

-- CreateIndex
CREATE INDEX "stock_count_sessions_tenantId_idx" ON "stock_count_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "stock_count_sessions_status_idx" ON "stock_count_sessions"("status");

-- CreateIndex
CREATE INDEX "stock_count_sessions_tenantId_status_snapshotAt_idx" ON "stock_count_sessions"("tenantId", "status", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_sessions_tenantId_sessionNo_key" ON "stock_count_sessions"("tenantId", "sessionNo");

-- CreateIndex
CREATE INDEX "stock_count_lines_sessionId_idx" ON "stock_count_lines"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_sessionId_itemId_key" ON "stock_count_lines"("sessionId", "itemId");

-- CreateIndex
CREATE INDEX "period_closes_tenantId_idx" ON "period_closes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "period_closes_tenantId_year_month_key" ON "period_closes"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "period_snapshots_periodCloseId_idx" ON "period_snapshots"("periodCloseId");

-- CreateIndex
CREATE UNIQUE INDEX "period_snapshots_periodCloseId_itemId_locationId_key" ON "period_snapshots"("periodCloseId", "itemId", "locationId");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_entityType_entityId_idx" ON "audit_log"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_changedAt_idx" ON "audit_log"("tenantId", "changedAt");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_changedBy_idx" ON "audit_log"("tenantId", "changedBy");

-- CreateIndex
CREATE UNIQUE INDEX "doc_sequence_tenantId_prefix_year_key" ON "doc_sequence"("tenantId", "prefix", "year");

-- CreateIndex
CREATE INDEX "grn_imports_tenantId_status_idx" ON "grn_imports"("tenantId", "status");

-- CreateIndex
CREATE INDEX "grn_imports_tenantId_vendorId_idx" ON "grn_imports"("tenantId", "vendorId");

-- CreateIndex
CREATE INDEX "grn_imports_tenantId_locationId_idx" ON "grn_imports"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "grn_imports_tenantId_grnNumber_key" ON "grn_imports"("tenantId", "grnNumber");

-- CreateIndex
CREATE INDEX "grn_lines_grnImportId_idx" ON "grn_lines"("grnImportId");

-- CreateIndex
CREATE INDEX "grn_lines_grnImportId_isMapped_idx" ON "grn_lines"("grnImportId", "isMapped");

-- CreateIndex
CREATE INDEX "item_mappings_tenantId_idx" ON "item_mappings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "item_mappings_tenantId_futurelogItemCode_key" ON "item_mappings"("tenantId", "futurelogItemCode");

-- CreateIndex
CREATE INDEX "uom_mappings_tenantId_idx" ON "uom_mappings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "uom_mappings_tenantId_futurelogUom_key" ON "uom_mappings"("tenantId", "futurelogUom");

-- CreateIndex
CREATE INDEX "vendor_mappings_tenantId_idx" ON "vendor_mappings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_mappings_tenantId_futurelogVendorName_key" ON "vendor_mappings"("tenantId", "futurelogVendorName");

-- CreateIndex
CREATE INDEX "store_requisitions_tenantId_idx" ON "store_requisitions"("tenantId");

-- CreateIndex
CREATE INDEX "store_requisitions_tenantId_status_idx" ON "store_requisitions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "store_requisitions_tenantId_locationId_idx" ON "store_requisitions"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "store_requisitions_tenantId_requisitionNo_key" ON "store_requisitions"("tenantId", "requisitionNo");

-- CreateIndex
CREATE INDEX "store_requisition_lines_requisitionId_idx" ON "store_requisition_lines"("requisitionId");

-- CreateIndex
CREATE INDEX "store_issues_tenantId_idx" ON "store_issues"("tenantId");

-- CreateIndex
CREATE INDEX "store_issues_tenantId_requisitionId_idx" ON "store_issues"("tenantId", "requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "store_issues_tenantId_issueNo_key" ON "store_issues"("tenantId", "issueNo");

-- CreateIndex
CREATE INDEX "store_issue_lines_issueId_idx" ON "store_issue_lines"("issueId");

-- CreateIndex
CREATE INDEX "store_issue_lines_requisitionLineId_idx" ON "store_issue_lines"("requisitionLineId");

-- CreateIndex
CREATE INDEX "store_transfers_tenantId_idx" ON "store_transfers"("tenantId");

-- CreateIndex
CREATE INDEX "store_transfers_tenantId_status_idx" ON "store_transfers"("tenantId", "status");

-- CreateIndex
CREATE INDEX "store_transfers_tenantId_sourceLocationId_idx" ON "store_transfers"("tenantId", "sourceLocationId");

-- CreateIndex
CREATE INDEX "store_transfers_tenantId_destLocationId_idx" ON "store_transfers"("tenantId", "destLocationId");

-- CreateIndex
CREATE UNIQUE INDEX "store_transfers_tenantId_transferNo_key" ON "store_transfers"("tenantId", "transferNo");

-- CreateIndex
CREATE INDEX "store_transfer_lines_transferId_idx" ON "store_transfer_lines"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_usage_tenantId_key" ON "tenant_usage"("tenantId");

-- CreateIndex
CREATE INDEX "super_admin_logs_adminUserId_idx" ON "super_admin_logs"("adminUserId");

-- CreateIndex
CREATE INDEX "super_admin_logs_targetTenantId_idx" ON "super_admin_logs"("targetTenantId");

-- CreateIndex
CREATE INDEX "super_admin_logs_createdAt_idx" ON "super_admin_logs"("createdAt");

-- CreateIndex
CREATE INDEX "tenant_settings_tenantId_idx" ON "tenant_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenantId_key_key" ON "tenant_settings"("tenantId", "key");

-- CreateIndex
CREATE INDEX "get_passes_tenantId_idx" ON "get_passes"("tenantId");

-- CreateIndex
CREATE INDEX "get_passes_tenantId_status_idx" ON "get_passes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "get_passes_departmentId_idx" ON "get_passes"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "get_passes_tenantId_passNo_key" ON "get_passes"("tenantId", "passNo");

-- CreateIndex
CREATE INDEX "get_pass_lines_getPassId_idx" ON "get_pass_lines"("getPassId");

-- CreateIndex
CREATE INDEX "get_pass_lines_itemId_idx" ON "get_pass_lines"("itemId");

-- CreateIndex
CREATE INDEX "get_pass_lines_locationId_idx" ON "get_pass_lines"("locationId");

-- CreateIndex
CREATE INDEX "get_pass_returns_getPassLineId_idx" ON "get_pass_returns"("getPassLineId");

-- CreateIndex
CREATE INDEX "get_pass_returns_returnDate_idx" ON "get_pass_returns"("returnDate");

-- CreateIndex
CREATE UNIQUE INDEX "saved_stock_reports_approvalRequestId_key" ON "saved_stock_reports"("approvalRequestId");

-- CreateIndex
CREATE INDEX "saved_stock_reports_tenantId_idx" ON "saved_stock_reports"("tenantId");

-- CreateIndex
CREATE INDEX "saved_stock_reports_tenantId_status_idx" ON "saved_stock_reports"("tenantId", "status");

-- CreateIndex
CREATE INDEX "saved_stock_reports_tenantId_locationId_idx" ON "saved_stock_reports"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_stock_reports_tenantId_reportNo_key" ON "saved_stock_reports"("tenantId", "reportNo");

-- CreateIndex
CREATE INDEX "saved_stock_report_lines_reportId_idx" ON "saved_stock_report_lines"("reportId");

-- CreateIndex
CREATE INDEX "saved_stock_report_location_qtys_lineId_idx" ON "saved_stock_report_location_qtys"("lineId");

-- CreateIndex
CREATE INDEX "saved_stock_report_location_qtys_locationId_idx" ON "saved_stock_report_location_qtys"("locationId");

-- CreateIndex
CREATE INDEX "generated_reports_tenantId_idx" ON "generated_reports"("tenantId");

-- CreateIndex
CREATE INDEX "generated_reports_tenantId_reportType_idx" ON "generated_reports"("tenantId", "reportType");

-- CreateIndex
CREATE INDEX "generated_reports_tenantId_departmentId_idx" ON "generated_reports"("tenantId", "departmentId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcategories" ADD CONSTRAINT "subcategories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_categories" ADD CONSTRAINT "location_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_categories" ADD CONSTRAINT "location_categories_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_users" ADD CONSTRAINT "location_users_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_users" ADD CONSTRAINT "location_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_defaultStoreId_fkey" FOREIGN KEY ("defaultStoreId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_documents" ADD CONSTRAINT "movement_documents_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_documents" ADD CONSTRAINT "movement_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_lines" ADD CONSTRAINT "movement_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "movement_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_lines" ADD CONSTRAINT "movement_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movement_lines" ADD CONSTRAINT "movement_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "movement_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_storeTransferId_fkey" FOREIGN KEY ("storeTransferId") REFERENCES "store_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_actedBy_fkey" FOREIGN KEY ("actedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_requiredRoleId_fkey" FOREIGN KEY ("requiredRoleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_importedBy_fkey" FOREIGN KEY ("importedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "import_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_movementDocumentId_fkey" FOREIGN KEY ("movementDocumentId") REFERENCES "movement_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_sessions" ADD CONSTRAINT "stock_count_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "stock_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_snapshots" ADD CONSTRAINT "period_snapshots_periodCloseId_fkey" FOREIGN KEY ("periodCloseId") REFERENCES "period_closes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_sequence" ADD CONSTRAINT "doc_sequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_importedBy_fkey" FOREIGN KEY ("importedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grnImportId_fkey" FOREIGN KEY ("grnImportId") REFERENCES "grn_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_mappings" ADD CONSTRAINT "item_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_mappings" ADD CONSTRAINT "uom_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_mappings" ADD CONSTRAINT "vendor_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisitions" ADD CONSTRAINT "store_requisitions_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisitions" ADD CONSTRAINT "store_requisitions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisitions" ADD CONSTRAINT "store_requisitions_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisitions" ADD CONSTRAINT "store_requisitions_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisitions" ADD CONSTRAINT "store_requisitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisition_lines" ADD CONSTRAINT "store_requisition_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisition_lines" ADD CONSTRAINT "store_requisition_lines_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "store_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_requisition_lines" ADD CONSTRAINT "store_requisition_lines_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_issuedBy_fkey" FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "store_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "store_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_requisitionLineId_fkey" FOREIGN KEY ("requisitionLineId") REFERENCES "store_requisition_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_destLocationId_fkey" FOREIGN KEY ("destLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfers" ADD CONSTRAINT "store_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfer_lines" ADD CONSTRAINT "store_transfer_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfer_lines" ADD CONSTRAINT "store_transfer_lines_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "store_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_transfer_lines" ADD CONSTRAINT "store_transfer_lines_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_usage" ADD CONSTRAINT "tenant_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_logs" ADD CONSTRAINT "super_admin_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_admin_logs" ADD CONSTRAINT "super_admin_logs_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_checkedOutBy_fkey" FOREIGN KEY ("checkedOutBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_deptApprovedBy_fkey" FOREIGN KEY ("deptApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_financeApprovedBy_fkey" FOREIGN KEY ("financeApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_securityApprovedBy_fkey" FOREIGN KEY ("securityApprovedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_passes" ADD CONSTRAINT "get_passes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_pass_lines" ADD CONSTRAINT "get_pass_lines_getPassId_fkey" FOREIGN KEY ("getPassId") REFERENCES "get_passes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_pass_lines" ADD CONSTRAINT "get_pass_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_pass_lines" ADD CONSTRAINT "get_pass_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_pass_returns" ADD CONSTRAINT "get_pass_returns_getPassLineId_fkey" FOREIGN KEY ("getPassLineId") REFERENCES "get_pass_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_pass_returns" ADD CONSTRAINT "get_pass_returns_registeredBy_fkey" FOREIGN KEY ("registeredBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "get_pass_returns" ADD CONSTRAINT "get_pass_returns_securityVerifiedBy_fkey" FOREIGN KEY ("securityVerifiedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_reports" ADD CONSTRAINT "saved_stock_reports_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_reports" ADD CONSTRAINT "saved_stock_reports_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_reports" ADD CONSTRAINT "saved_stock_reports_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_reports" ADD CONSTRAINT "saved_stock_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_report_lines" ADD CONSTRAINT "saved_stock_report_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_report_lines" ADD CONSTRAINT "saved_stock_report_lines_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "saved_stock_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_report_location_qtys" ADD CONSTRAINT "saved_stock_report_location_qtys_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "saved_stock_report_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_stock_report_location_qtys" ADD CONSTRAINT "saved_stock_report_location_qtys_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
