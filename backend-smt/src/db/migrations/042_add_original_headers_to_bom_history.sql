-- Migration: Add original_headers column to bom_history
ALTER TABLE bom_history ADD COLUMN IF NOT EXISTS original_headers JSONB;
