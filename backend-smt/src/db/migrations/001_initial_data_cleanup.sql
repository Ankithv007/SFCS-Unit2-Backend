-- 001_initial_data_cleanup.sql
-- Removes hyphens from serial numbers and formats
UPDATE smt_serial_numbers SET serial_number = REPLACE(serial_number, '-', '') WHERE serial_number LIKE '%-%';
UPDATE smt_serial_numbers SET serial_format = REPLACE(serial_format, '-', '') WHERE serial_format LIKE '%-%';
