-- Migration 018: Backfill sl_no in rrh_programming_inspections from IPQC and IVI
UPDATE rrh_programming_inspections p
SET sl_no = COALESCE(
    ipqc.sl_no,
    ivi.sl_no,
    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(p.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(p.serial_number)) LIMIT 1),
    (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM(COALESCE(p.band_serial_no, p.serial_number))) LIMIT 1)
)
FROM rrh_ipqc_inspections ipqc
LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = ipqc.ivi_inspection_id
WHERE (p.ipqc_inspection_id = ipqc.id OR UPPER(TRIM(ipqc.serial_number)) = UPPER(TRIM(p.serial_number)) OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = UPPER(TRIM(p.serial_number)))
  AND (p.sl_no IS NULL OR p.sl_no = '');
