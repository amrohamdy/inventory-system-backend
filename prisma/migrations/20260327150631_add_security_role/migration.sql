-- Add SECURITY role to UserRole enum (safe additive change)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SECURITY';

