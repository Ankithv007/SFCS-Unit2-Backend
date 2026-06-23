# Documentation: SMT Quality Management System (QMS)

## VERSION 2.0: DOCUMENT PROCESS (QMS)

### 1. PAGE NAME
**Document Process / QMS Master (SMT - Version 2.0)**
*   **What is it?** This page acts as the Quality Management System (QMS) file manager and document control center. It binds manufacturing files (BOM, PFC, XY coordinates, engineering drawings, and ECN logs) to specific product lines and Work Orders.
*   **Why does it exist?** A manufacturing floor must only operate on approved design files. The QMS module ensures that engineering drawings, bill of materials (BOM), and machine placement programs are validated and revision-controlled. Work orders are linked to these files to establish a consistent, single source of truth.

---

### 2. BUSINESS PURPOSE
*   **Revision Control:** Prevents operators or placement machines from referencing outdated component lists or coordinates. Allows tracking of incremental BOM changes.
*   **File Centralization:** Eliminates paper blueprints and uncontrolled server folders by consolidating BOM, PFC, XY coordinates, drawings, and ECN logs under a single QMS record.
*   **Work Order Mapping:** Enables direct binding of target Work Orders to a specific certified QMS ID before starting production.
*   **Auditor Traceability:** Integrates with `BackendAuthContext` to log the exact authenticated supervisor/manager who uploaded or authorized a file release.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **QMS Administrator** | Upload and verify files (BOM, PFC, XY, Drawings, ECNs), release new revisions. |
| **Production Planner** | Map Work Orders to approved QMS master configurations. |
| **Machine Operators** | View and download approved documents (read-only access). |
| **Super Admin** | Full privileges, including record archiving/deletion (restricted). |

---

### 4. COMPLETE WORKFLOW
1.  **Access:** Authenticated user navigates to **SMT -> Document Process** (`/smt/qms`).
2.  **Creation of QMS Record:**
    *   Planner selects a registered Work Order.
    *   Enter the initial revision number (defaults to Rev 1.1).
3.  **File Uploads:**
    *   Select and upload the **BOM (Bill of Materials)** file (usually `.xlsx` / `.csv`).
    *   Select and upload supplementary files: **PFC (Process Flow Chart)**, **XY Coordinates**, **Engineering Drawing**, and **ECN (Engineering Change Notice)** logs.
    *   File upload middleware handles type checks and saves files to the server's secure `uploads` directory.
4.  **Parsing & Storage:**
    *   The backend parses the uploaded BOM file and inserts component rows (VEPL Part Number, Description, Manufacturer, Manufacturer Part Number, Quantity per Product) into the `qms_bom_items` table.
5.  **Release & Usage:**
    *   Once a QMS record is saved, it becomes available under SMT Material Requests and Material Return.
    *   Only released revisions can be used for material issuing.

---

### 5. UI SECTION EXPLANATION
*   **QMS Form Editor:** Interactive modal or page view for registering new QMS instances and file bindings.
*   **Document Upload Status Indicator:** Shows which files are active, missing, or pending review with visual indicators.
*   **BOM Revision Log Grid:** Shows the history of all uploaded revisions, allowing staff to download previously active versions or preview active BOM rows.
*   **Document Downloader:** Secure buttons that invoke API endpoints to stream file content for offline viewing.

---

### 6. DATABASE DESIGN
**Table Name:** `qms_master`

| Column | Type | Description / Constraints |
| :--- | :--- | :--- |
| `id` | SERIAL (PK) | Auto-incrementing identifier |
| `work_order_id` | VARCHAR(255) | Linked Work Order Number (FK `smt_work_orders.id`) |
| `bom_file_path` | TEXT | Server path to the raw BOM spreadsheet |
| `pfc_file_path` | TEXT | Server path to the PFC file |
| `xy_file_path` | TEXT | Server path to XY coordinates |
| `ecn_file_path` | TEXT | Server path to ECN log |
| `drawing_file_path`| TEXT | Server path to PDF drawings |
| `status` | VARCHAR(50) | Status (`DRAFT`, `RELEASED`, `ARCHIVED`) |
| `created_by` | VARCHAR(255) | Authenticated creator username |

**Table Name:** `qms_bom_items`

| Column | Type | Description / Constraints |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Auto-generated UUID |
| `bom_revision_id` | UUID | Linked BOM revision (FK) |
| `sl_no` | VARCHAR(50) | Component sequence index |
| `vepl_part_no` | VARCHAR(255)| VEPL item number |
| `description` | TEXT | Component description |
| `manufacturer` | TEXT | Manufacturer Name |
| `manufacturer_part_no`| VARCHAR(255)| Manufacturer item number |
| `qty_per_product` | NUMERIC | Number of parts needed per PCB assembly |

---

### 7. BACKEND LOGIC (API)
*   **Endpoints:**
    *   `POST /api/smt/qms/create` - Form data and multiple files upload.
    *   `GET /api/smt/qms/records` - Fetch master QMS entries.
    *   `GET /api/smt/qms/files/:action/:qmsId/:fileType` - Stream or download uploaded files.
*   **Upload Handler:** Uses configured `multer` helper (`qmsUpload`) to write files into `/app/uploads` under secure hashed file names.

---

### 8. FRONTEND LOGIC
*   **Multi-part Form Submission:** Frontend uses `FormData` objects to package files alongside JSON metadata values.
*   **Grid Preview:** Reads parsed JSON lists from backend and renders them using React tables for operators to verify before release.
