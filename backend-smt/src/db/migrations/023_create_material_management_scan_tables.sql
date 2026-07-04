-- Migration: Create Issued Material Details and Scan Audit Log tables
CREATE TABLE IF NOT EXISTS issued_material_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_request_item_id UUID NOT NULL REFERENCES material_management_items(id) ON DELETE CASCADE,
    uid VARCHAR(255) NOT NULL,
    vepl_part_no VARCHAR(255) NOT NULL,
    issued_qty DECIMAL(18,4) NOT NULL,
    scanned_by VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(material_request_item_id, uid)
);

CREATE TABLE IF NOT EXISTS material_management_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_request_number VARCHAR(255) NOT NULL,
    vepl_part_no VARCHAR(255) NOT NULL,
    uid VARCHAR(255) NOT NULL,
    quantity DECIMAL(18,4) NOT NULL,
    operator VARCHAR(255) NOT NULL,
    action VARCHAR(100) DEFAULT 'Material Issued',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issued_material_details_item ON issued_material_details(material_request_item_id);
CREATE INDEX IF NOT EXISTS idx_material_management_audit_logs_mr ON material_management_audit_logs(material_request_number);
