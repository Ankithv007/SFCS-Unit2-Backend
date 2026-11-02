# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 23: QMS DOCUMENT MANAGEMENT

### 1. PAGE NAME
**QMS Document Repository & BOM Revision Engine**
*   **What is it?** This page documents the Quality Management System (QMS) module, which manages production documents, drawing file uploads, and BOM revision history.
*   **Why does it exist?** It serves as the single source of truth for technical documents, automating BOM component extraction and matching.

---

### 2. BUSINESS PURPOSE
*   **Revision Integrity:** Enforces that assembly lines always reference the active engineering drawings and BOM configurations.
*   **Component Parsing Automation:** Extracts component registries from Excel files directly into SQL rows, mapping parts to procurement codes.
*   **What if it didn't exist?** Operators might assemble boards using outdated drawings or mismatched part numbers, leading to total batch failures.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Can view and open PFC, XY, and drawing files; cannot upload or delete records. |
| **QA Engineer / Planner** | Can create QMS records, upload files, revise BOM items, and add comments. |
| **Admin** | Full access to soft-delete records and purge physical files. |

---

### 4. COMPLETE WORKFLOW
1.  **Record Creation:** The QA Engineer selects a Work Order and mounts the QMS dossier.
2.  **File Selection:** Uploads document attachments: BOM (Excel), PFC (PDF), XY (TXT), ECN (PDF), and up to 3 Assembly Drawings (PDF/images).
3.  **BOM Parsing:** The system opens the Excel, scans the first 20 rows of sheet `BOM` for the label `BOM Rev No:`, and extracts the version string.
4.  **Item Extraction:** Scans rows starting below the headers, verifies that the serial number is a valid integer, and bulk-inserts components into `qms_bom_items`.
5.  **Dossier Activation:** The files are compressed, stored, and hashed, releasing the document package to the production line.

---

### 5. UI SECTION EXPLANATION
*   **Document Upload Center:** Interactive drag-and-drop slots for the 5 key document types.
*   **Extracted Components Grid:** Lists parsed items showing columns: Sl No, VEPL Part No, Description, Manufacturer, Manufacturer Part No, and Qty.
*   **Revision History Timeline:** Audit view showing previous document versions, uploaders, and remarks.

---

### 6. DATABASE DESIGN
#### Table: `qms_master`
*   `id` (SERIAL PRIMARY KEY)
*   `work_order_number` (VARCHAR UNIQUE)
*   `po_number` / `product_name` / `product_description` / `quantity`
*   `bom_file_path` / `pfc_file_path` / `xy_data_file_path` / `ecn_file_path` / `assembly_drawing_file_path` (VARCHAR)
*   `files_metadata` (JSONB)
*   `current_bom_revision` (VARCHAR)
*   `created_by` / `created_at`

#### Table: `qms_bom_revisions`
*   `id` (SERIAL PRIMARY KEY)
*   `qms_id` (INT REFERENCES `qms_master`)
*   `revision_number` (VARCHAR)
*   `bom_file_path` (VARCHAR)
*   `original_name` (VARCHAR)
*   `original_size` / `compressed_size` (BIGINT)
*   `compression_ratio` (NUMERIC)
*   `file_hash` / `compressed_file_hash` (VARCHAR)
*   `uploaded_by` / `uploaded_at` (TIMESTAMP)

#### Table: `qms_bom_items`
*   `id` (SERIAL PRIMARY KEY)
*   `qms_id` (INT REFERENCES `qms_master`)
*   `bom_revision_id` (INT REFERENCES `qms_bom_revisions`)
*   `sl_no` (VARCHAR) - Serial number from Excel
*   `vepl_part_no` / `description` / `manufacturer` / `manufacturer_part_no` (VARCHAR)
*   `qty_per_product` (NUMERIC)

#### Table: `qms_file_revisions`
*   Tracks file revisions history (`bom`, `pfc`, `xy`, `ecn`, `drawing`).

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/qmsController.ts`
*   **Parsing Logic:**
    *   Finds `BOM` sheet case-insensitively.
    *   Extracts revision using cell offset checks.
    *   Validates headers: maps variations like `mfr`, `make`, `manufacturer` to DB fields.

---

### 8. FRONTEND LOGIC
*   **Component:** `src/pages/smt/qms/QMS.tsx`
*   **Display Logic:** Uses iframe or browser tabs to display PDF drawings, PFC charts, and text XY coordinate files directly on the operator terminal.

---

### 9. STATUS FLOW
1.  **Draft:** Files uploading, not yet validated.
2.  **Active:** Document package approved and released to production line.
3.  **Superseded:** A new revision was uploaded; old files are marked historical.

---

### 10. VALIDATION RULES
*   **File Constraints:** Limit drawings to a maximum of 3 files.
*   **BOM Worksheet:** Must contain sheet named `BOM` (trimmed, case-insensitive).
*   **Header Mapping:** Fails upload if `sl_no`, `vepl_part_no`, and `description` headers cannot be mapped.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Activity Logs:** `qms_activity_logs` logs actions (`create`, `update-file`, `delete`) along with client IP addresses.
*   **File Hashing:** Computes SHA256 hashes of original and compressed files to detect corruption or tampering.

---

### 12. ERROR SCENARIOS
*   **Revision Label Missing:** Uploaded sheet has no `BOM Rev No:` label in the first 20 rows. *System Alert: "BOM Revision Number not found in the uploaded Excel."*
*   **Invalid Row Format:** Reading approvals text at the bottom. *Validation action: regex `/^\d+$/` fails on serial number, safely skipping the footer row.*

---

### 13. REAL-TIME INDUSTRY SCENARIO
Engineering updates a PCBA capacitor from Yageo to Samsung. The QA Engineer uploads the updated Excel BOM sheet. The system locates the `BOM` worksheet, finds label `BOM Rev No:`, extracts `1.4` (previous was `1.3`), parses the 120 components list, ignores the footer notes, updates `qms_bom_items`, and logs the change. The operator's terminal refreshes, showing the Samsung capacitor immediately.

---

### 14. DEVELOPMENT CHALLENGES
*   **Footer Noise:** Excel sheets contain signatures, legend explanations, and blank lines at the bottom. Directly parsing the sheet caused database integrity violations or created garbage database items.
*   **Solution:** Implemented regex verification on the `sl_no` column (e.g. `/^\d+$/`), checking that the value is a positive integer, effectively skipping footer and signature cells.

---

### 15. FUTURE IMPROVEMENTS
*   **Visual Diff:** Render a side-by-side visual diff of PDF drawing updates.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Document library that registers, hashes, and stores production files, automatically parsing Excel files to extract component lists and tracking drawing changes.
*   **Commits:** `1cd0ae4`, `3d5a53d`, `12d2886`
