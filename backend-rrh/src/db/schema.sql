-- Baseline Schema for RRH (Remote Radio Head) Database

CREATE TABLE IF NOT EXISTS rrh_work_orders (
    id SERIAL PRIMARY KEY,
    work_order_id VARCHAR(100) UNIQUE NOT NULL,
    work_order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    lot_quantity INT NOT NULL CHECK (lot_quantity > 0),
    excel_filename VARCHAR(255),
    excel_file_path VARCHAR(500),
    excel_file_size BIGINT,
    excel_columns JSONB DEFAULT '[]'::jsonb,
    excel_data JSONB DEFAULT '[]'::jsonb,
    total_excel_rows INT DEFAULT 0,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_wo_id
ON rrh_work_orders(work_order_id);

CREATE INDEX IF NOT EXISTS idx_rrh_work_orders_date
ON rrh_work_orders(work_order_date);
