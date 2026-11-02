# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 16: BOM SPLIT MODULE

### 1. PAGE NAME
**BOM Split & Component Synchronization**
*   **What is it?** This page documents the BOM Split module, which parses, validates, and deduplicates raw customer Bill of Materials (BOM) workbooks.
*   **Why does it exist?** It automates the separation of Customer Part Numbers (CPN) and their corresponding Manufacturer Part Numbers (MPN), synchronizing quantities and designators at the CPN level.

---

### 2. BUSINESS PURPOSE
*   **CPN-Level Synchronization:** Ensures quantity (`Qty`) and reference designator (`Ref`) changes are synchronized across all manufacturer alternatives for a single CPN.
*   **Automation:** Replaces manual spreadsheet cleaning, reducing the preparation time for pick-and-place machines from hours to seconds.
*   **What if it didn't exist?** Engineers would manually deduplicate raw client BOM files in Excel, leading to human errors, mismatched references, and component shortage shutdowns.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can view the parsed BOM history and download processed files. |
| **BOM Planner / Engineer** | Can upload raw BOM files, trigger parses, edit CPN details, and reset logs. |
| **Administrator** | Full access to clean tables, override versions, and purge physical files. |

---

### 4. COMPLETE WORKFLOW
1.  **File Upload:** The engineer uploads an Excel file (`.xlsx` or `.xls`) through the drag-and-drop panel.
2.  **Header Recognition:** The backend searches the first 15 rows of the `COI info` sheet to match required headers.
3.  **Parsing & Deduplication:** The engine groups rows by CPN and removes duplicate manufacturer part combinations.
4.  **Database Recording:** Records are saved to `bom_history`, and items are saved to `bom_split_items`.
5.  **Report Generation:** A processed Excel is generated where CPN columns are vertically merged for clean readability.
6.  **Component Editing:** The engineer can update `Qty` or `Ref` for any CPN in the UI, which automatically updates all child variants and rebuilds the Excel.

---

### 5. UI SECTION EXPLANATION
*   **Upload Container:** Dashboard widget with file validation limits (50MB).
*   **Deduplicated Grid:** Displays components grouped by CPN with editing inputs for Qty and Ref.
*   **Excel Merged Preview:** Live grid showing columns (`Customer Part Number`, `Description`, `Mfr`, `Mfr. Part No`, `Qty`, `Ref`).
*   **Audit logs list:** Activity monitor detailing actions, status, and operator names.

---

### 6. DATABASE DESIGN
#### Table 1: `bom_history`
Tracks each uploaded file session.
*   `id` (SERIAL PRIMARY KEY)
*   `version` (VARCHAR) e.g., `1.0`, `1.1`
*   `original_file_name` / `stored_original_file_name` (VARCHAR)
*   `original_file_path` / `processed_file_path` (VARCHAR)
*   `file_size` / `compressed_file_size` (BIGINT)
*   `uploaded_by_id` / `uploaded_by_name` / `uploaded_by_role` / `uploaded_by_code`
*   `uploaded_date` (DATE) / `uploaded_time` (TIME)
*   `workbook_status` / `parse_status` (VARCHAR)
*   `processing_duration` (INT)
*   `original_rows` / `processed_rows` / `duplicate_rows_removed` (INT)
*   `original_headers` (JSONB)
*   `is_deleted` (BOOLEAN DEFAULT false)

#### Table 2: `bom_split_items`
Tracks deduplicated components.
*   `id` (SERIAL PRIMARY KEY)
*   `bom_history_id` (INT REFERENCES `bom_history`)
*   `cpn` (VARCHAR) - Customer Part Number
*   `description` (TEXT)
*   `mfr` / `mfr_part_no` (VARCHAR)
*   `qty` / `ref` (VARCHAR)
*   `display_order` (INT)

#### Table 3: `bom_split_audit_logs`
Tracks audit history with operator names.
*   `id` (SERIAL PRIMARY KEY)
*   `bom_history_id` (INT)
*   `version` (VARCHAR)
*   `action` (VARCHAR) e.g., `UPLOAD`, `RE-UPLOAD`, `UPDATE QTY`, `UPDATE REF`, `RESET`
*   `employee_id` / `employee_name` / `employee_role` / `employee_code`
*   `status` (VARCHAR) e.g. `SUCCESS`, `FAILED`
*   `processing_duration` (INT)
*   `ip_address` (VARCHAR)
*   `file_name` (VARCHAR)
*   `file_size` (BIGINT)
*   `remarks` (TEXT)
*   `action_date` (DATE) / `action_time` (TIME)

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/bomSplitController.ts`
*   **Endpoints:**
    *   `POST /api/bom-split/parse` (uploads and processes the Excel)
    *   `GET /api/bom-split/history` (returns paginated log history)
    *   `PUT /api/bom-split/items/:itemId` (updates Qty/Ref for all matching CPN items)
    *   `POST /api/bom-split/reset` (cleans the database tables and physical directories)
*   **Libraries:** `exceljs` for reading/writing, `multer` for parsing uploads.

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/bom-split/BOMSplit.tsx`
*   **Features:**
    *   File upload handling via drag-and-drop.
    *   CPN overview list containing editable inputs for `qty` and `ref`.
    *   Audit logs viewer displaying date-times, statuses, and operators.

---

### 9. STATUS FLOW
1.  **Valid/SUCCESS:** Parsed correctly with all columns mapped.
2.  **Invalid/FAILED:** Error occurred (e.g. missing sheet, bad columns, type mismatches).

---

### 10. VALIDATION RULES
*   **Worksheet Target:** Must contain a worksheet named exactly `COI info` (case-insensitive search).
*   **Header Mapping:** Must locate columns matching:
    *   *Customer Part Number:* Matches `cpn`, `customerpartnumber`, `customerpartno`.
    *   *Description:* Matches `description`, `desc`.
    *   *Mfr:* Matches `mfr`, `manufacturer`, `mfg`, `make`.
    *   *Mfr. Part No:* Matches `mfrpartno`, `mfrpartnumber`, `mpn`.
    *   *Qty:* Matches `qty`, `quantity`.
    *   *Ref:* Matches `ref`, `reference`, `designator`.
*   **Size Limit:** Restricted to 50MB.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Attribution:** Captured through the logged operator's `name` and `employee_code` (e.g., `Ankith (EMP102)`).
*   **Database Logs:** Every edit to a component's reference designator or quantity is recorded inside `bom_split_audit_logs`.

---

### 12. ERROR SCENARIOS
*   **Missing Sheet:** Uploaded spreadsheet doesn't have `COI info`. *System Alert: "Missing worksheet 'COI info'."*
*   **Missing Headers:** The worksheet lacks a `Customer Part Number` column. *System Alert: "Required columns are missing..."*
*   **Concurrency Collision:** Two planners editing the same CPN. *System Alert: "Record modified by another user."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
A raw customer Excel contains a list of 400 components. Under CPN `CPN-1029-A`, there are three rows listing manufacturer numbers from Samsung, Yageo, and Murata, but Yageo has a different quantity typed by mistake. The engineer uploads the file. The BOM Split module flags `CPN-1029-A`, aggregates the three rows, alerts the user, and lets them change the quantity to a unified `10` directly. The processed Excel compiles this automatically.

---

### 14. DEVELOPMENT CHALLENGES
*   **Column Merging:** In standard excel exports, listing three manufacturer options repeats CPN data, looking messy.
*   **Solution:** Programmatically tracked row indices in `exceljs` and executed `worksheet.mergeCells()` on the CPN, Description, Qty, and Ref columns for each duplicate manufacturer group.

---

### 15. FUTURE IMPROVEMENTS
*   **Format Auto-detect:** Parse `.csv` and `.txt` files directly.
*   **BOM Compare:** Compare two uploaded versions and highlight differences in red.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** A specialized BOM parser that matches columns, groups variants by CPN, deduplicates manufacturer part numbers, merges Excel cells, and provides an editable grid with full audit logging.
*   **Commits:** `3491536`, `aba7358`, `f375960`, `b34d5ec`
