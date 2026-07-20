-- Migration: 002_make_email_optional.sql
-- Purpose: Make users.email column nullable (optional)

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
