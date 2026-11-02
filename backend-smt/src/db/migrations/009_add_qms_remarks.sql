-- Add qms_remarks column to qms_master table
ALTER TABLE qms_master ADD COLUMN IF NOT EXISTS qms_remarks TEXT;
