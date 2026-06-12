-- Migration to add PO document fields and database optimization indexes to smt_work_orders
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS po_document_name VARCHAR(255);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS po_document_path VARCHAR(500);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS po_document_type VARCHAR(100);
ALTER TABLE smt_work_orders ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP;

-- Index on created_at for fast pagination/sorting performance
CREATE INDEX IF NOT EXISTS idx_smt_work_orders_created_at ON smt_work_orders(created_at DESC);

-- Index on id (Work Order ID) for fast searches
CREATE INDEX IF NOT EXISTS idx_smt_work_orders_id ON smt_work_orders(id);
