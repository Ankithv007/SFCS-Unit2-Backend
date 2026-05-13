# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 6: POST AOI (AUTOMATED OPTICAL INSPECTION)

### 1. PAGE NAME
**Post AOI Inspection**
*   **What is it?** AOI (Automated Optical Inspection) is a high-speed camera system that automatically checks the PCB for errors after components have been placed. "Post AOI" is the MES stage where these results are logged.
*   **Why does it exist?** Humans cannot reliably check thousands of tiny components per minute. AOI identifies missing parts, wrong polarity (components placed backward), or tombstoning (components standing upright).

---

### 2. BUSINESS PURPOSE
*   **100% Component Verification:** Ensures every single resistor, capacitor, and IC is in its correct place.
*   **First-Pass Yield Tracking:** Measures the accuracy of the Pick & Place machines.
*   **Defect Escape Prevention:** The last "Automated" gate before the board becomes a finished PCBA.
*   **What if it didn't exist?** A single reversed diode or missing resistor could make the entire electronic device non-functional, leading to expensive field returns.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **AOI Operator** | Syncs the machine result with the MES by scanning the board. |
| **Debug Technician** | Analyzes "FAIL" results to determine if the board can be repaired. |
| **Line Leader** | Uses AOI data to calibrate Pick & Place machine nozzles. |

---

### 4. COMPLETE WORKFLOW
1.  **Select WO:** Operator selects the active Work Order.
2.  **AOI Machine Check:** The machine scans the board and displays the result on its screen.
3.  **MES Scanning:**
    *   Operator scans the PCB serial number.
    *   **Sequence Check:** System verifies the board passed **SPI** (Page 4).
4.  **Result Entry:**
    *   **PASS:** Board is clear to move to the next soldering stage.
    *   **FAIL:** Operator clicks FAIL and enters the component-level defect (e.g., "R12 Missing", "C5 Reversed").
5.  **Database Update:** Record is stored in `smt_inspections` with `process_step = 'Post AOI'`.

---

### 5. UI SECTION EXPLANATION
*   **Inspection Stats:** 
    *   **Available:** Boards that successfully cleared SPI.
    *   **Completed:** Boards that have a logged AOI result.
*   **Item Table:** 
    *   Displays a **QR Code** for each board to allow for secondary manual verification.
    *   **Status Badges:** Green (✓ PASSED), Red (● FAIL), or Yellow (🕒 PENDING).
*   **Rework Input:** When "FAIL" is clicked, an inline text box appears for the operator to type the specific defect reason immediately.

---

### 6. DATABASE DESIGN
**Table:** `smt_inspections`

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `serial_id` | INTEGER | Link to PCB |
| `process_step` | VARCHAR | `Post AOI` |
| `status` | VARCHAR | `PASS` or `FAIL` |
| `rework_reason`| TEXT | Specific component failure info |

---

### 7. BACKEND LOGIC
*   **Eligibility API:** The backend uses a SQL filter to ensure that only boards with `SPI = PASS` appear in the "Available" list for Post AOI. This prevents "skipping" the solder paste inspection.

---

### 8. FRONTEND LOGIC
*   **Inline Rework UI:** Unlike SPI (which uses a prompt), Post AOI uses an inline input box within the table row. This allows the operator to stay focused on the list without annoying popups.
*   **Auto-Focus:** The scan input is always focused to ensure high-speed processing.

---

### 9. STATUS FLOW
1.  **ELIGIBLE:** Board passed SPI.
2.  **PENDING:** Board scanned at AOI but result not yet clicked.
3.  **PASS:** Ready for Reflow/Post-Work Soldering.
4.  **FAIL:** Blocked; sent to Rework station.

---

### 10. VALIDATION RULES
*   **Sequence Enforcement:** System blocks the scan if `SPI` status is anything other than `PASS`.
*   **Uniqueness:** Prevents scanning the same board twice within the same AOI batch.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Defect Mapping:** By recording *which* component failed (e.g., R12), the system builds a "Heatmap" of defects. If R12 fails 10 times, the engineer knows to check that specific Pick & Place nozzle.

---

### 12. ERROR SCENARIOS
*   **"Serial not ready":** Usually means the board was never scanned at the SPI station.
*   **"Already In List":** Board was already scanned in the current session.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A Pick & Place machine runs out of a specific 10k resistor, and the machine keeps running (a "Dry Run").
*   **The Action:** AOI detects "Missing Components" on 50 boards. The Operator marks them all as **FAIL** in MES with the reason "Resistor Reel Empty".
*   **Mistake Prevention:** This prevents these empty boards from being soldered, which would make adding the resistors much harder later.

---

### 14. DEVELOPMENT CHALLENGES
*   **Session Persistence:** Using `sessionStorage` to remember which Work Orders the user has already opened, improving the UI experience when switching tabs.

---

### 15. FUTURE IMPROVEMENTS
*   **Real-time Image Attachment:** Allow the operator to take a photo of the defect and upload it directly to the MES record via the browser.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** The "Robot Eyes" check. Ensures all components are on the board and correctly aligned.
*   **Quick Workflow:** Confirm board passed SPI -> Machine Result -> Record PASS or FAIL.
*   **Key Business Importance:** Ensures 100% component placement accuracy.
