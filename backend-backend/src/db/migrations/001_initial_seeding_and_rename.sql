-- Seed Production Stages
INSERT INTO production_stages (stage_name, stage_order) 
VALUES 
    ('PTH', 1),
    ('VI', 2),
    ('QA', 3),
    ('Flashing', 4),
    ('PCBA-FCT', 5),
    ('Assembly', 6),
    ('Unit Testing', 7),
    ('QI', 8),
    ('Packing', 9),
    ('Rework', 10),
    ('Debug', 11)
ON CONFLICT (stage_name) DO NOTHING;

-- Rename Remark Tables if they exist and target names don't
DO $$ 
BEGIN 
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'remark_batches') 
       AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rework_batches') THEN
        ALTER TABLE IF EXISTS remark_batches RENAME TO rework_batches;
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'remark_scans') 
       AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rework_scans') THEN
        ALTER TABLE IF EXISTS remark_scans RENAME TO rework_scans;
    END IF;
END $$;
