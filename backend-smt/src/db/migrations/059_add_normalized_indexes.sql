-- Migration 059: Add functional indexes for database-side case/whitespace insensitive barcode lookups

CREATE INDEX idx_smt_serial_numbers_upper_serial 
ON smt_serial_numbers(UPPER(BTRIM(serial_number)));

CREATE INDEX idx_smt_inspections_upper_barcode 
ON smt_inspections(UPPER(BTRIM(scanned_barcode)));
