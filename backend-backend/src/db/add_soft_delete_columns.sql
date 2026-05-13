-- Add Soft Delete Columns to all Production Batch Tables

DO $$
DECLARE
    t text;
    tables_list text[] := ARRAY[
        'pth_batches', 'vi_batches', 'qa_batches', 'flashing_batches', 
        'pcba_fct_batches', 'assembly_batches', 'unit_testing_batches', 
        'qi_batches', 'packing_batches', 'rework_batches', 'debug_batches'
    ];
BEGIN
    FOREACH t IN ARRAY tables_list LOOP
        -- Add is_deleted if not exists
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'is_deleted') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE', t);
        END IF;
        
        -- Add deleted_at if not exists
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'deleted_at') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN deleted_at TIMESTAMP', t);
        END IF;
        
        -- Add deleted_by if not exists
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'deleted_by') THEN
            EXECUTE format('ALTER TABLE %I ADD COLUMN deleted_by VARCHAR(100)', t);
        END IF;
    END LOOP;
END $$;
