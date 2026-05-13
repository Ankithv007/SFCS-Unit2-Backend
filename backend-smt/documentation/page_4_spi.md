# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 4: SPI (SOLDER PASTE INSPECTION)

### 1. PAGE NAME
**SPI (Solder Paste Inspection)**
*   **What is it?** This is a quality gate immediately following the Printing stage. It uses high-speed cameras (3D or 2D) to measure the solder paste applied to each pad.
*   **Why does it exist?** Solder paste defects (insufficient paste, bridging, or excess) are the leading cause of SMT failures. SPI catches these before any components are placed, making rework cheap and easy.

---

### 2. BUSINESS PURPOSE
*   **Defect Prevention:** Identifies printing errors *before* the board is populated with expensive chips.
*   **Process Improvement:** Provides feedback to the Printing station (e.g., "Stencil needs cleaning" or "Squeegee pressure is too low").
*   **Cost Savings:** Washing a bad board and re-printing is much cheaper than de-soldering components later.
*   **What if it didn't exist?** Poor solder joints would be hidden under components, leading to "latent defects" that fail only after the product is in the customer's hands.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **SPI Operator** | Scans the board and records the inspection result (PASS or FAIL). |
| **QA Inspector** | Audits the failure reasons and confirms if a board needs "Wash" or "Manual Touch-up". |
| **Supervisor** | Tracks the "First Pass Yield" (FPY) of the printing process. |

---

### 4. COMPLETE WORKFLOW
1.  **Select WO:** Operator selects the active Work Order.
2.  **Machine Inspection:** The SPI machine scans the board and gives a result.
3.  **MES Scanning:**
    *   Operator scans the PCB serial number into the MES system.
    *   System validates that the board was previously "Printed" (Sequence Check).
4.  **Result Entry:**
    *   If the machine shows Pass: Operator clicks **PASS**.
    *   If the machine shows Fail: Operator clicks **FAIL** and enters a **Rework Reason** (e.g., "Solder Bridge", "Insufficient Paste").
5.  **Database Update:** Record is saved in `smt_inspections` with `process_step = 'SPI'`.
6.  **Next Step Unlock:** If PASS, the board is now eligible for the "Previous Soldering" or "Pick & Place" stages.

---

### 5. UI SECTION EXPLANATION
*   **Setup Card:** Confirms the Product Name, Quantity, and who is performing the inspection.
*   **Live Stats Row:**
    *   **Total Scanned:** How many boards from this batch have reached SPI.
    *   **Completed:** Count of boards that successfully passed.
    *   **Pending:** Number of boards registered but not yet seen at SPI.
*   **Scanning Form:** Large indigo-bordered input for the barcode scanner.
*   **Action Buttons (In Table):**
    *   **Green PASS Button:** Quick-click to mark the board as good.
    *   **Red FAIL Button:** Opens a prompt to enter the defect reason.

---

### 6. DATABASE DESIGN
**Table:** `smt_inspections`

| Column | Type | Purpose | Example |
| :--- | :--- | :--- | :--- |
| `serial_id` | INTEGER | Link to specific PCB | `1024` |
| `process_step` | VARCHAR | Current stage | `SPI` |
| `status` | VARCHAR | Result | `PASS` or `FAIL` |
| `rework_reason` | TEXT | Description of defect | `Solder Bridge on U12` |
| `scanned_by` | VARCHAR | Operator ID | `Inspector_Rahul` |

---

### 7. BACKEND LOGIC
*   **History Fetching:** The backend queries `smt_inspections` joined with `smt_serial_numbers` to show the full list of boards currently at the SPI station.
*   **Validation API:** When a serial is scanned, the backend ensures the board exists in that specific Work Order.

---

### 8. FRONTEND LOGIC
*   **Prompt Logic:** When "FAIL" is clicked, the system uses a `window.prompt` (or custom modal) to force the user to enter a reason. This ensures data integrity—you can't fail a board without saying why.
*   **Live List Rendering:** The list is sorted in reverse-chronological order (newest scan at the top) so the operator can see their immediate last action.

---

### 9. STATUS FLOW
1.  **PENDING:** The board is in the list but no result has been clicked.
2.  **PASS:** Board is ready for the next machine.
3.  **FAIL:** Board is flagged for rework. It must be "Fixed" or "Washed" before it can be scanned again.

---

### 10. VALIDATION RULES
*   **Forced Rework Reason:** The system blocks the "FAIL" submission if the reason field is empty.
*   **Work Order Lockdown:** You cannot scan a board into SPI if the Work Order is already "Completed" or "Closed".

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Defect History:** Every "FAIL" remains in the history. Even if a board is fixed and eventually passes, the record that it *once failed* SPI is preserved for quality analysis.

---

### 12. ERROR SCENARIOS
*   **Duplicate Scanning:** "Barcode is already in the list" alert.
*   **Out of Sequence:** Board scanned at SPI before being scanned at Printing. *System Alert: "Serial not found or not ready for SPI".*

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** The SPI machine detects a "Solder Bridge" (two pads connected by paste) on three consecutive boards.
*   **The Action:** The Operator hits **FAIL** in MES for all three, entering "Repeated Bridge". They then stop the line to check the stencil for paste buildup.
*   **Mistake Prevention:** Without this, those 3 boards would go into the oven, and the bridge would become a permanent short-circuit, potentially destroying components.

---

### 14. DEVELOPMENT CHALLENGES
*   **Data Consistency:** Ensuring the `total available` count matches the number of boards that passed the Printing stage. *Solution: Using complex SQL `JOIN` with `EXISTS` clauses.*

---

### 15. FUTURE IMPROVEMENTS
*   **Machine Integration:** Connect directly to the SPI machine's API (e.g., Koh Young or CyberOptics) to automatically pull the PASS/FAIL result without the operator clicking a button.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Checks if the solder paste is "just right"—not too much, not too little.
*   **Quick Workflow:** Scan Board -> Machine Result -> Click PASS or FAIL (with reason).
*   **Key Business Importance:** The "Early Warning System" of the SMT line.
