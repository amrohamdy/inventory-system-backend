-- Add PENDING_SECURITY between GM approval and final APPROVED (security gate before exit).
ALTER TYPE "GetPassStatus" ADD VALUE 'PENDING_SECURITY' BEFORE 'APPROVED';
