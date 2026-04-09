-- GRN: record which user posted to ledger (audit).

ALTER TABLE "grn_imports" ADD COLUMN "postedBy" UUID;

ALTER TABLE "grn_imports" ADD CONSTRAINT "grn_imports_postedBy_fkey" FOREIGN KEY ("postedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
