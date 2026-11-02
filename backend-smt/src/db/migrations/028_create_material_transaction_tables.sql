-- Migration: Create Material Transaction Tables and Alter Scan Detail Tables
CREATE TABLE IF NOT EXISTS material_issue_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_management_id UUID NOT NULL REFERENCES material_management(id) ON DELETE CASCADE,
    transaction_number VARCHAR(255) UNIQUE NOT NULL,
    completed_by VARCHAR(255) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_parts INT NOT NULL,
    total_issued_qty DECIMAL(18,4) NOT NULL
);

CREATE TABLE IF NOT EXISTS material_return_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_management_id UUID NOT NULL REFERENCES material_management(id) ON DELETE CASCADE,
    transaction_number VARCHAR(255) UNIQUE NOT NULL,
    completed_by VARCHAR(255) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_parts INT NOT NULL,
    total_returned_qty DECIMAL(18,4) NOT NULL
);

-- Add transaction foreign keys to detail tables
ALTER TABLE issued_material_details ADD COLUMN IF NOT EXISTS material_issue_transaction_id UUID REFERENCES material_issue_transactions(id) ON DELETE SET NULL;
ALTER TABLE returned_material_details ADD COLUMN IF NOT EXISTS material_return_transaction_id UUID REFERENCES material_return_transactions(id) ON DELETE SET NULL;

-- Create default/migrated transactions for existing completed records so we don't break existing data
DO $$
DECLARE
    m_row RECORD;
    t_issue_id UUID;
    t_return_id UUID;
    t_num VARCHAR(255);
    cnt_parts INT;
    sum_qty DECIMAL(18,4);
BEGIN
    FOR m_row IN SELECT mm.id, mm.work_order_number FROM material_management mm LOOP
        -- For issues
        SELECT COUNT(DISTINCT imd.material_request_item_id), COALESCE(SUM(imd.issued_qty), 0)
        INTO cnt_parts, sum_qty
        FROM issued_material_details imd
        JOIN material_management_items mmi ON imd.material_request_item_id = mmi.id
        WHERE mmi.material_management_id = m_row.id;

        IF cnt_parts > 0 THEN
            t_num := 'MIT-MIG-' || m_row.work_order_number || '-' || LEFT(gen_random_uuid()::text, 8);
            INSERT INTO material_issue_transactions (material_management_id, transaction_number, completed_by, total_parts, total_issued_qty)
            VALUES (m_row.id, t_num, 'System Migration', cnt_parts, sum_qty)
            RETURNING id INTO t_issue_id;

            UPDATE issued_material_details imd
            SET material_issue_transaction_id = t_issue_id
            FROM material_management_items mmi
            WHERE imd.material_request_item_id = mmi.id
              AND mmi.material_management_id = m_row.id
              AND imd.material_issue_transaction_id IS NULL;
        END IF;

        -- For returns
        SELECT COUNT(DISTINCT imd.material_request_item_id), COALESCE(SUM(rmd.returned_qty), 0)
        INTO cnt_parts, sum_qty
        FROM returned_material_details rmd
        JOIN issued_material_details imd ON rmd.issued_material_detail_id = imd.id
        JOIN material_management_items mmi ON imd.material_request_item_id = mmi.id
        WHERE mmi.material_management_id = m_row.id;

        IF cnt_parts > 0 THEN
            t_num := 'MRT-MIG-' || m_row.work_order_number || '-' || LEFT(gen_random_uuid()::text, 8);
            INSERT INTO material_return_transactions (material_management_id, transaction_number, completed_by, total_parts, total_returned_qty)
            VALUES (m_row.id, t_num, 'System Migration', cnt_parts, sum_qty)
            RETURNING id INTO t_return_id;

            UPDATE returned_material_details rmd
            SET material_return_transaction_id = t_return_id
            FROM issued_material_details imd
            JOIN material_management_items mmi ON imd.material_request_item_id = mmi.id
            WHERE rmd.issued_material_detail_id = imd.id
              AND mmi.material_management_id = m_row.id
              AND rmd.material_return_transaction_id IS NULL;
        END IF;
    END LOOP;
END $$;
