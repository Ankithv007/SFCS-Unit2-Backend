-- Add job_number column to stencil_master table
ALTER TABLE stencil_master
ADD COLUMN IF NOT EXISTS job_number VARCHAR(100);

-- Populate existing rows with a default value
UPDATE stencil_master
SET job_number = 'JOB-SYSTEM-INIT'
WHERE job_number IS NULL;

-- Make it NOT NULL for future records
ALTER TABLE stencil_master
ALTER COLUMN job_number SET NOT NULL;
