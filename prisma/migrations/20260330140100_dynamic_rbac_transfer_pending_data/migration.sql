-- Postgres requires a separate migration after enum values are committed before using new labels.
UPDATE "store_transfers"
SET "status" = 'PENDING_DEPT'::"TransferStatus"
WHERE "status" = 'SUBMITTED'::"TransferStatus";
