-- PostgreSQL requires a newly added enum value to be committed before it can
-- be referenced by constraints in a later transaction.
ALTER TYPE "InvocationSource" ADD VALUE IF NOT EXISTS 'cron';
