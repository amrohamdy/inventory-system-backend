# Smoke Test — M13 Phase 2 Breakage & Loss Report

Run at      : 2026-02-27T21:15:19.269Z
User        : admin@grandhorizon.com
dateFrom    : 2024-01-01
dateTo      : 2027-12-31
locationId  : (all locations — no filter)

## Key Definitions
- **Posting Date** = `inventoryLedger.createdAt` (moment of posting)
- **documentCount** = COUNT DISTINCT `referenceNo` (not row count)

## Environment
Backend      : http://localhost:4000
Tenant slug  : grand-horizon