-- Migration 057: Fix pending_auto_fg_jobs session id types to VARCHAR(255)
-- Ensures support for UUID session IDs from smt_post_aoi_sessions and smt_fg_sessions

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pending_auto_fg_jobs' AND column_name = 'post_aoi_session_id' AND data_type != 'character varying'
    ) THEN
        ALTER TABLE pending_auto_fg_jobs ALTER COLUMN post_aoi_session_id TYPE VARCHAR(255);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pending_auto_fg_jobs' AND column_name = 'fg_session_id' AND data_type != 'character varying'
    ) THEN
        ALTER TABLE pending_auto_fg_jobs ALTER COLUMN fg_session_id TYPE VARCHAR(255);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'pending_auto_fg_jobs' AND column_name = 'side'
    ) THEN
        ALTER TABLE pending_auto_fg_jobs ADD COLUMN side VARCHAR(30) NOT NULL DEFAULT 'Top';
    END IF;
END $$;
