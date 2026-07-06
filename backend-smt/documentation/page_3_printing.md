# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 3: SOLDER PASTE PRINTING

### 1. PAGE NAME
**Solder Paste Printing**
*   **What is it?** This page manages the first physical stage of the SMT line. It is where solder paste is applied to the PCB through a stencil. 
*   **Why does it exist?** Quality in SMT starts with printing. If the paste application is wrong, the entire board will fail. This page ensures that the correct tools (Stencil, Paste) are used and tracks each board that passes this stage.

---

### 2. BUSINESS PURPOSE
*   **Process Standardization:** Ensures the operator uses the specific stencil and solder paste type defined for the product.
*   **Tool Tracking:** Logs which squeegee and stencil were used, which is vital for wear-and-tear analysis and quality audits.
*   **Production Velocity:** Tracks how many boards are being printed per hour.
*   **What if it didn't exist?** Operators might use the wrong stencil or expired solder paste, leading to thousands of dollars in wasted components and rework.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **SMT Operator** | Performs the setup (enters stencil/paste details) and scans each board. |
| **Material Handler** | Verifies that the solder paste lot matches the system entry. |
| **Line Leader** | Approves the "First Piece" after printing setup. |
| **Maintenance** | Tracks the squeegee and stencil usage cycles for cleaning/replacement. |

---

### 4. COMPLETE WORKFLOW

#### Step 1: Setup Preparation
1.  Operator selects a **Registered Work Order**.
2.  Operator enters the **Stencil ID**, **Squeegee Number**, and **Solder Paste Lot/Name**.
3.  Operator selects the **Side** (TOP or BOTTOM).
4.  User clicks "Start Printing Process". This creates a record in the `smt_process_setups` table.

#### Step 2: PCB Processing
1.  The machine prints paste on the PCB.
2.  The Operator takes the PCB and scans its serial number label.
3.  **System Validation:**
    *   System checks if the serial number was generated.
    *   System checks if it hasn't already been printed.
4.  **Database Update:** A new record is added to `smt_inspections` with `process_step = 'Printing'` and `status = 'PASS'`.
5.  **UI Feedback:** The progress counter increments, and the row turns green in the "Items" table.

---

### 5. UI SECTION EXPLANATION
*   **Shift Indicator:** Automatically detects the current shift (A, B, C, or G) based on system time.
*   **Setup Form:** 
    *   **Work Order Selector:** Only shows WOs that have generated serial numbers.
    *   **Tooling Fields:** Text inputs for Stencil, Squeegee, and Paste.
    *   **Side Selection:** Toggle between TOP/BOTTOM (Critical for double-sided boards).
*   **Batch Detail View:**
    *   **Live Stats:** Shows Total Available vs. Scanned vs. Passed.
    *   **Scan Input:** Large, high-visibility input for the barcode scanner.
    *   **QR Preview:** Displays the QR code of the board to visually confirm the data.

---

### 6. DATABASE DESIGN
**Table 1: `smt_process_setups` (Master Setup)**
| Column | Type | Purpose |
| :--- | :--- | :--- |
| `id` | SERIAL | Primary Key |
| `work_order_id`| VARCHAR | Linked Work Order |
| `stencil_name` | VARCHAR | ID of the metal stencil used |
| `solder_paste` | VARCHAR | Brand/Lot of the paste |
| `side` | VARCHAR | TOP or BOTTOM |
| `timestamp` | TIMESTAMP | When the setup started |

**Table 2: `smt_inspections` (Transaction Log)**
| Column | Type | Purpose |
| :--- | :--- | :--- |
| `serial_id` | INTEGER | ID of the specific PCB |
| `process_step` | VARCHAR | Hardcoded as `Printing` |
| `status` | VARCHAR | Usually `PASS` |
| `scanned_at` | TIMESTAMP | Precise time board left the printer |

---

### 7. BACKEND LOGIC
*   **Process Setup API (`POST /api/smt/process-setups`):**
    *   Saves the "Environment" data (Tools used).
*   **Inspection API (`POST /api/smt/inspections`):**
    *   Receives the `serial_id` and `step`.
    *   **Status Sync:** Automatically updates the main `smt_serial_numbers` status to `SCANNED` (if not already) to ensure the board is moving through the flow.

---

### 8. FRONTEND LOGIC
*   **Shift Detection Logic:** Uses a JavaScript `new Date().getHours()` function to map time ranges to Shift names (e.g., 6 AM - 3 PM = Shift A).
*   **Auto-Scan Logic:** A `useEffect` hook that triggers the "Process" function as soon as the scanner sends the full barcode string. This removes the need for the operator to press "Enter" or click a button manually.
*   **Detail-View Toggle:** Uses a conditional state `viewingWoId` to switch between the "Setup List" and the "Active Scanning" screen.

---

### 9. STATUS FLOW
1.  **Pending:** Serial number is generated but has not reached the printer.
2.  **PASSED (in Printing):** Serial number has been scanned at the Printing station.
3.  **REWORK:** (Optional) If the paste is smudged, the operator can manually clear the record and re-print (managed via "Reset" or "Delete" in some versions).

---

### 10. VALIDATION RULES
*   **Sequence Validation:** A board cannot be "Printed" if its serial number was not first generated.
*   **Duplicate Prevention:** A board cannot be "Printed" twice in the same batch (Prevents double-scanning errors).
*   **Mandatory Tools:** Setup cannot start if Stencil or Paste fields are empty.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Full Context:** If a board fails in the field 1 year later, you can check this audit trail to see:
    *   Exactly what **Stencil** was used.
    *   Which **Solder Paste** lot was applied.
    *   Which **Operator** was running the machine at that exact minute.

---

### 12. ERROR SCENARIOS
*   **"Serial not ready":** The serial number has not been generated. *Fix: Generate serial numbers for the Work Order.*
*   **"Wrong Side":** Operator is scanning a "BOTTOM" side board while the system is set to "TOP". *Fix: Change Side Selection in Setup.*
*   **"Database Timeout":** API fails to respond. *Fix: Handled by toaster notification "Failed to save record".*

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** The solder paste on the machine has dried out after a 30-minute line stoppage.
*   **The Action:** The operator cleans the stencil and replaces the paste. They update the **Solder Paste** lot number on this page to reflect the new material.
*   **Mistake Prevention:** If a quality issue arises later, the QA team can see exactly which boards were printed with the "Old" paste vs. the "New" paste.

---

### 14. DEVELOPMENT CHALLENGES
*   **Shift Boundary Logic:** Handling shifts that cross midnight (Shift C: 11 PM - 7 AM). *Solution: Use hour-based ranges with modulo or simple if-else checks.*
*   **Concurrent Scans:** Multiple operators on different lines scanning at once. *Solution: Stateless API design with specific `serial_id` targeting.*

---

### 15. FUTURE IMPROVEMENTS
*   **Solder Paste Expiry Alert:** The system could block scanning if the solder paste lot is older than 8 hours (standard room-temp life).
*   **Stencil Cycle Counter:** Automatically notify maintenance when the stencil reaches 10,000 prints for tension checking.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** This page records that solder paste was applied correctly using the right tools.
*   **Quick Workflow:** Enter Tools (Stencil/Paste) -> Select Side -> Scan PCBs as they are printed.
*   **Key Business Importance:** Prevents 70% of SMT defects (which usually originate at the printing stage).
