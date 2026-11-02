-- Migration 004_remove_solder_paste_unique.sql
-- Remove unique constraint on solder_paste_barcode in smt_work_orders

ALTER TABLE smt_work_orders DROP CONSTRAINT IF EXISTS smt_work_orders_solder_paste_barcode_key;
