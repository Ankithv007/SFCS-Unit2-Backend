# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 2: SERIAL NUMBER GENERATION

### 1. PAGE NAME
**Serial Number Generation**
*   **What is it?** This page is used to generate unique identifiers (Serial Numbers) for each individual PCB under a Work Order.
*   **Why does it exist?** In electronics manufacturing, every single board must have a unique "DNA" (Serial Number). This page acts as the bridge between a virtual Work Order and the physical PCBs being produced.

---

### 2. BUSINESS PURPOSE
*   **Unique Traceability:** Ensures no two PCBs in the world have the same serial number.
*   **Preventing Over-Production:** Limits serial number generation to the exact quantity specified in the Work Order.
*   **What if it didn't exist?** You would have a batch of identical-looking boards with no way to tell which one failed a test or which one was shipped to which customer.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Label Room Operator** | Generates the serial numbers and prints labels. |
| **Supervisor** | Monitors how many serials are generated. |
| **Admin** | Can delete faulty batches or reset serial numbers. |

---

### 4. COMPLETE WORKFLOW

#### Generation Workflow
1.  **Select WO:** User selects a pending Work Order from the dropdown. Product details auto-fill.
2.  **Define Source:** User selects Barcode Source ("Generate Barcode" or "Barcode Already Available").
3.  **Define Format:** User enters a Prefix (e.g., `PCB-`).
4.  **Define Range:** User enters **Starting Number** (e.g., 1) and **End Number** (e.g., 100).
5.  **System Check:** Backend checks if any serial in this range (`PCB-000001` to `PCB-000100`) already exists.
6.  **Bulk Creation:** System creates 100 records in `smt_serial_numbers`.

---

### 5. UI SECTION EXPLANATION
*   **Generation Form:**
    *   **Work Order Dropdown:** Filters only those WOs that don't have serials generated yet.
    *   **Barcode Source Selector:** Choose whether to auto-generate or use preexisting barcodes.
    *   **Serial Format Input:** Restricted to 10 characters (Standard industry practice).
    *   **Start/End Number:** Defines the numeric range for auto-increment.
*   **Generated Batches Table:** Displays summary of all created serial ranges with details (WO, Product, Qty, Starting/Ending Number, Creator).
*   **Active Batch View:** Displays all generated serial numbers in a table with a printable QR code label format.

---

### 6. DATABASE DESIGN
**Table Name:** `smt_serial_numbers`

| Column | Type | Purpose | Example |
| :--- | :--- | :--- | :--- |
| `id` | SERIAL | Internal Primary Key | `1024` |
| `work_order_id` | VARCHAR | Link to WO table | `WO2024051300001` |
| `serial_format` | VARCHAR | The prefix used | `PCB-` |
| `serial_number` | VARCHAR | **Unique** full string | `PCB-000001` |
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
*   **Delete API (`DELETE /api/smt/serial-numbers`):**
    *   Allows deleting a batch for reset (Restricted to Super Admin).

---

### 8. FRONTEND LOGIC
*   **QR Code Printing Layout:** Generates a clean HTML print window that formats QR codes and serial labels automatically for standard label printers.
*   **QR Code Rendering:** Uses `qrcode` and `react-qr-code` to render previews of barcodes.

---

### 9. STATUS FLOW
1.  **Created:** The serial number exists in the database and is ready to enter the production line at the Printing stage.

---

### 10. VALIDATION RULES
*   **Format Validation:** Prevents special characters in serial numbers.
*   **Range Validation:** `Starting Number` must be less than `End Number`.
*   **Work Order Limit:** You cannot generate more serials than the Work Order quantity.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Generation Log:** Every batch records the `created_by` and `created_at` values.
*   **Traceability:** Marks the "Birth" of the physical product.

---

### 12. ERROR SCENARIOS
*   **Format Mismatch / Empty Fields:** Form validation prevents submission.
*   **Duplicate Range:** Backend throws an error if serials already exist.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** The Label room operator generates 500 serial numbers for a new Work Order.
*   **The Action:** The operator checks the generated range, clicks print, and prints the labels onto thermal stickers.
*   **Mistake Prevention:** Prevents printing duplicate barcode stickers across different lines or batches.

---

### 14. DEVELOPMENT CHALLENGES
*   **High Volume Performance:** Generating 5000 serials at once can be slow. *Solution: Bulk SQL insertion instead of 5000 individual insert queries.*
*   **Print Sizing:** Different label printers have varying margins. *Solution: Strict CSS `@media print` print-sheet specifications.*

---

### 15. FUTURE IMPROVEMENTS
*   **Zebra Printer Integration:** Send the generation command directly to a thermal printer (ZPL language).
*   **Duplicate Range Warning:** If a user tries to generate `001-100` but `050` already exists, show a detailed error list.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** This page creates the serial number range and prints barcode stickers.
*   **Quick Workflow:** Select Work Order -> Choose Barcode Source -> Generate Serials -> Print Labels.
*   **Key Business Importance:** It ensures 100% individual board traceability and prevents label-printing errors.
