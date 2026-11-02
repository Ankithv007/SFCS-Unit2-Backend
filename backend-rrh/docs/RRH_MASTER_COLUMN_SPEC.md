# RRH Master Data Excel 32-Column Canonical Specification & Ingestion Matrix

## 1. Executive Summary & Verification Math
The RRH Master Data Ingestion subsystem consumes a standard 32-column Excel workbook. The fields are split into three normalized database domains:
- **Base Information (rrh_inventory)**: Columns 1 to 14 (14 columns)
- **Existing Sub-Unit Inventory (rrh_existing_inventory)**: Columns 15 to 24 (10 columns)
- **Replaced Sub-Unit Inventory (rrh_replaced_inventory)**: Columns 25 to 32 (8 columns)

**Verification Formula**: `14 (Base) + 10 (Existing) + 8 (Replaced) = 32 Columns Total`

---

## 2. Canonical 32-Column Specification Table

| Position | Canonical Header | Target Table | Target Column | Data Type | Nullable | Description / Example |
|---|---|---|---|---|---|---|
| **1** | `SL No` | `rrh_inventory` | `sl_no` | `VARCHAR(100)` | YES | Serial / Line number in batch (e.g. `1`, `SL001`) |
| **2** | `Tejas DC No` | `rrh_inventory` | `tejas_dc_no` | `VARCHAR(100)` | YES | Tejas Delivery Challan Number |
| **3** | `Tejas OBD No` | `rrh_inventory` | `tejas_obd_no` | `VARCHAR(100)` | YES | Tejas Outbound Delivery Number |
| **4** | `Physical TPN` | `rrh_inventory` | `physical_tpn` | `VARCHAR(100)` | YES | Physical Tejas Part Number |
| **5** | `Band Serial No` | `rrh_inventory` | `band_serial_no` | `VARCHAR(100)` | YES | Primary Unit / Band Serial Number |
| **6** | `PR No` | `rrh_inventory` | `pr_no` | `VARCHAR(100)` | YES | Purchase Requisition / Request Number |
| **7** | `Invoice/ RMA No` | `rrh_inventory` | `invoice_rma_no` | `VARCHAR(100)` | YES | Invoice or RMA identifier |
| **8** | `Vendor Name for Rework` | `rrh_inventory` | `vendor_name_for_rework` | `VARCHAR(255)` | YES | Assigned rework vendor name |
| **9** | `Coordinator Name` | `rrh_inventory` | `coordinator_name` | `VARCHAR(100)` | YES | RRH operations coordinator |
| **10** | `Issued Date` | `rrh_inventory` | `issued_date` | `DATE` | YES | Work order issue date (safely parsed) |
| **11** | `Lot` | `rrh_inventory` | `lot` | `VARCHAR(100)` | YES | Production / Rework Lot identifier |
| **12** | `Remarks` | `rrh_inventory` | `remarks` | `TEXT` | YES | Initial remarks / notes |
| **13** | `Failure Description` | `rrh_inventory` | `failure_description` | `TEXT` | YES | Reported symptom / failure details |
| **14** | `Remarks 2` | `rrh_inventory` | `remarks_2` | `TEXT` | YES | Secondary remarks |
| **15** | `RFPC No` | `rrh_existing_inventory` | `rfpc_no` | `VARCHAR(100)` | YES | Existing RFPC serial / identifier |
| **16** | `PAM0 SL No` | `rrh_existing_inventory` | `pam0_sl_no` | `VARCHAR(100)` | YES | Existing PAM Channel 0 serial number |
| **17** | `PAM1 SL No` | `rrh_existing_inventory` | `pam1_sl_no` | `VARCHAR(100)` | YES | Existing PAM Channel 1 serial number |
| **18** | `PAM2 SL No` | `rrh_existing_inventory` | `pam2_sl_no` | `VARCHAR(100)` | YES | Existing PAM Channel 2 serial number |
| **19** | `PAM3 SL No` | `rrh_existing_inventory` | `pam3_sl_no` | `VARCHAR(100)` | YES | Existing PAM Channel 3 serial number |
| **20** | `LNA SL No` | `rrh_existing_inventory` | `lna_sl_no` | `VARCHAR(100)` | YES | Existing LNA serial number |
| **21** | `RFPC Model No` | `rrh_existing_inventory` | `rfpc_model_no` | `VARCHAR(100)` | YES | Existing RFPC hardware model |
| **22** | `SW Version` | `rrh_existing_inventory` | `sw_version` | `VARCHAR(100)` | YES | Existing Software / Firmware version |
| **23** | `SFP0 Serial No` | `rrh_existing_inventory` | `sfp0_serial_no` | `VARCHAR(100)` | YES | Existing Optical SFP Port 0 serial number |
| **24** | `SFP1 Serial No` | `rrh_existing_inventory` | `sfp1_serial_no` | `VARCHAR(100)` | YES | Existing Optical SFP Port 1 serial number |
| **25** | `Replaced RFPC No` | `rrh_replaced_inventory` | `rfpc_no` | `VARCHAR(100)` | YES | Newly replaced RFPC serial / identifier |
| **26** | `Replaced PAM0 SL No` | `rrh_replaced_inventory` | `pam0_sl_no` | `VARCHAR(100)` | YES | Newly replaced PAM Channel 0 serial number |
| **27** | `Replaced PAM1 SL No` | `rrh_replaced_inventory` | `pam1_sl_no` | `VARCHAR(100)` | YES | Newly replaced PAM Channel 1 serial number |
| **28** | `Replaced PAM2 SL No` | `rrh_replaced_inventory` | `pam2_sl_no` | `VARCHAR(100)` | YES | Newly replaced PAM Channel 2 serial number |
| **29** | `Replaced PAM3 SL No` | `rrh_replaced_inventory` | `pam3_sl_no` | `VARCHAR(100)` | YES | Newly replaced PAM Channel 3 serial number |
| **30** | `Replaced LNA SL No` | `rrh_replaced_inventory` | `lna_sl_no` | `VARCHAR(100)` | YES | Newly replaced LNA serial number |
| **31** | `Replaced SFP0 Serial No` | `rrh_replaced_inventory` | `sfp0_serial_no` | `VARCHAR(100)` | YES | Newly replaced Optical SFP Port 0 serial number |
| **32** | `Replaced SFP1 Serial No` | `rrh_replaced_inventory` | `sfp1_serial_no` | `VARCHAR(100)` | YES | Newly replaced Optical SFP Port 1 serial number |

---

## 3. Real Files Ingestion Comparison Matrix

| File Name | Header Row | Detected Columns | Total Rows | Data Rows | Merged Ranges | Extra Sheets | Status |
|---|---|---|---|---|---|---|---|
| `WO_TEST_PROD_1790075171510.xlsx` | Row 2 | 32 | 32 | 30 | 4 ranges | None | VERIFIED REAL DATA |
| `WO_TEST_PROD_1790075215686.xlsx` | Row 2 | 32 | 32 | 30 | 4 ranges | None | VERIFIED REAL DATA |
| `WO_TEST_PROD_1790075283227.xlsx` | Row 2 | 32 | 102 | 100 | 4 ranges | None | VERIFIED REAL DATA |
| `new123.xlsx` | Row 2 | 32 | 22 | 20 | 0 ranges | None | VERIFIED REAL DATA |
| `wonew1122.xlsx` | Row 2 | 32 | 22 | 20 | 0 ranges | None | VERIFIED REAL DATA |
| `synthetic_master_300.xlsx` | Row 5 | 32 | 305 | 300 | 2 ranges (`A1:D1`, `B2:C2`) | None | VERIFIED SYNTHETIC EDGE-CASES |
| `synthetic_master_5000.xlsx` | Row 5 | 32 | 5005 | 5000 | 2 ranges (`A1:D1`, `B2:C2`) | None | VERIFIED SYNTHETIC SCALE |

---

## 4. Header Validation Policy
- **Rule**: Parser locates the header row by scanning for signature tokens (`Physical TPN`, `Band Serial No`, `SL No`, `TEJAS DC NO`).
- **Resilience**: Files with differing header naming or case variations log an informative warning with details, but **NEVER reject or drop files** as long as the 32 positional columns are present.
