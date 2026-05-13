# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 2: SERIAL NUMBER MANAGEMENT

### 1. PAGE NAME
**Serial Number Management (Generation & Registration)**
*   **What is it?** This page is used to generate unique identifiers (Serial Numbers) for each individual PCB under a Work Order and then "register" them through physical scanning.
*   **Why does it exist?** In electronics manufacturing, every single board must have a unique "DNA" (Serial Number). This page acts as the bridge between a virtual Work Order and the physical PCBs being produced.

---

### 2. BUSINESS PURPOSE
*   **Unique Traceability:** Ensures no two PCBs in the world have the same serial number.
*   **Preventing Over-Production:** Limits serial number generation to the exact quantity specified in the Work Order.
*   **Registration Verification:** Confirming that the physical labels are printed and readable before they enter the SMT line.
*   **What if it didn't exist?** You would have a batch of identical-looking boards with no way to tell which one failed a test or which one was shipped to which customer.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Label Room Operator** | Generates the serial numbers and prints labels. |
| **Line Operator** | Scans the labels to register them at the start of the SMT line. |
| **Supervisor** | Monitors how many serials are generated vs. registered. |
| **Admin** | Can delete faulty batches or reset serial numbers. |

---

### 4. COMPLETE WORKFLOW

#### Phase A: Generation
1.  **Select WO:** User selects a pending Work Order from the dropdown. Product details auto-fill.
2.  **Define Format:** User enters a Prefix (e.g., `PCB-`).
3.  **Define Range:** User enters **Starting Number** (e.g., 1) and **End Number** (e.g., 100).
4.  **System Check:** Backend checks if any serial in this range (`PCB-000001` to `PCB-000100`) already exists.
5.  **Bulk Creation:** System creates 100 records in `smt_serial_numbers`.

#### Phase B: Registration (Scanning)
1.  **View Batch:** User clicks "View" on a pending batch.
2.  **Physical Scan:** User uses a barcode scanner to scan the printed label.
3.  **Auto-Verification:** The system matches the scanned string against the database.
4.  **Status Update:** If matched, the status changes from `Created` to `SCANNED`.
5.  **Audit:** The system logs who scanned it and at what time.

---

### 5. UI SECTION EXPLANATION
*   **Generation Form:**
    *   **Work Order Dropdown:** Filters only those WOs that don't have serials generated yet.
    *   **Serial Format Input:** Restricted to 10 characters (Standard industry practice).
    *   **Start/End Number:** Defines the numeric range for auto-increment.
*   **Generated Batches Table:** Displays summary of all created serial ranges.
*   **Scanning Interface (Active Batch):**
    *   **Scan Input:** A "ghost" input that is always auto-focused. When a scanner sends data + Enter, it triggers the logic.
    *   **Live Progress Bar:** Shows `Registered / Total` count visually.
    *   **Paginated Table:** Shows individual serials with status icons (Green check for Scanned, Gray for Pending).

---

### 6. DATABASE DESIGN
**Table Name:** `smt_serial_numbers`

| Column | Type | Purpose | Example |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | Internal Primary Key | `1024` |
| `work_order_id` | VARCHAR | Link to WO table | `WO2024051300001` |
| `serial_format` | VARCHAR | The prefix used | `PCB-` |
| `serial_number` | VARCHAR | **Unique** full string | `PCB-000001` |
| `status` | VARCHAR | Current stage | `Created` or `SCANNED` |
| `created_by` | VARCHAR | Who generated it | `Label_Op_1` |
| `created_at` | TIMESTAMP | Generation time | `2024-05-13 09:00:00` |

*   **Unique Constraint:** `serial_number` column has a UNIQUE index to prevent duplicates at the database level.
*   **Relationship:** Foreign Key to `smt_work_orders`.

---

### 7. BACKEND LOGIC
*   **Generation API (`POST /api/smt/serial-numbers`):**
    *   Uses a `FOR` loop to construct serial strings.
    *   Uses `INSERT INTO ... ON CONFLICT DO NOTHING` to ensure data safety.
    *   **Transaction:** If generating 1000 serials, it happens in one block; if one fails, none are created.
*   **Scanning API (`PATCH /api/smt/serial-numbers/:id/status`):**
    *   Simple update query to change status to `SCANNED`.

---

### 8. FRONTEND LOGIC
*   **Auto-Focus Utility:** A `useRef` hook keeps the cursor in the scan box even after the user clicks elsewhere. This is critical for high-speed scanning.
*   **Auto-Scan Detection:** An `useEffect` hook monitors the input. If the scanned text matches a serial in the active list, it automatically calls the API—no need to click a "Submit" button.
*   **QR Code Generation:** Uses `qrcode.react` to display the QR on screen for testing.

---

### 9. STATUS FLOW
1.  **Created:** The serial number exists in the database but hasn't been seen by a scanner yet.
2.  **SCANNED:** The label has been physically verified at the start of the line.
3.  **WIP (Work In Progress):** (Future) Once it passes SPI/AOI.

---

### 10. VALIDATION RULES
*   **Format Validation:** Prevents special characters in serial numbers.
*   **Range Validation:** `Starting Number` must be less than `End Number`.
*   **Duplicate Scan Check:** If an operator scans the same board twice, the system plays an "Error" sound and shows an alert.
*   **Work Order Limit:** You cannot generate more serials than the Work Order quantity.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Scanning Log:** Every scan event records the `scanned_by` and `scanned_at` values.
*   **Traceability:** This is the most critical audit point. It marks the "Birth" of the physical product.

---

### 12. ERROR SCENARIOS
*   **Serial Not Found:** Operator scans a barcode from a different project. *System Alert: "Serial not found in this Work Order".*
*   **Already Scanned:** Operator scans the same board twice. *System Alert: "Serial already scanned".*
*   **Format Mismatch:** Start/End numbers are not provided. *Form prevents submission.*

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** The Label room prints 500 stickers. They bring them to the SMT Line 1.
*   **The Action:** The SMT Operator opens the "Pending Registration" view. They scan the first sticker. The system turns that row green. They continue until all 500 are green.
*   **Mistake Prevention:** If one sticker is missing or the printer skipped a number, the operator will see "499/500" and immediately know there is a missing board before it reaches the expensive SMT machines.

---

### 14. DEVELOPMENT CHALLENGES
*   **High Volume Performance:** Generating 5000 serials at once can be slow. *Solution: Bulk SQL insertion instead of 5000 individual insert queries.*
*   **Scanner Speed:** Modern scanners are very fast. The UI must handle inputs faster than a human can type. *Solution: `Debounce` and `auto-focus` logic.*

---

### 15. FUTURE IMPROVEMENTS
*   **Zebra Printer Integration:** Send the generation command directly to a thermal printer (ZPL language).
*   **Duplicate Range Warning:** If a user tries to generate `001-100` but `050` already exists, show a detailed error list.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** This page creates the "Labels" and verifies they are scanned.
*   **Quick Workflow:** Generate Serials -> Print Labels -> Scan Labels -> Batch is Ready.
*   **Key Business Importance:** It ensures 100% individual board traceability and prevents label-printing errors.
