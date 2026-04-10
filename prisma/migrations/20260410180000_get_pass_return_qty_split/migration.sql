-- Split quantities per return row (good / lost / damaged). qtyReturned remains total for the event.
ALTER TABLE "get_pass_returns" ADD COLUMN "qtyGood" DECIMAL(15,4) NOT NULL DEFAULT 0;
ALTER TABLE "get_pass_returns" ADD COLUMN "qtyLost" DECIMAL(15,4) NOT NULL DEFAULT 0;
ALTER TABLE "get_pass_returns" ADD COLUMN "qtyDamaged" DECIMAL(15,4) NOT NULL DEFAULT 0;

UPDATE "get_pass_returns"
SET
  "qtyLost" = CASE WHEN "isLost" THEN "qtyReturned" ELSE 0 END,
  "qtyDamaged" = CASE WHEN "isDamaged" AND NOT "isLost" THEN "qtyReturned" ELSE 0 END,
  "qtyGood" = CASE WHEN NOT "isLost" AND NOT "isDamaged" THEN "qtyReturned" ELSE 0 END;
