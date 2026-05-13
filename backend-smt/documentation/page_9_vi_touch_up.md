# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 9: VISUAL INSPECTION (VI) / TOUCH-UP

### 1. PAGE NAME
**Visual Inspection (VI) / Touch-up**
*   **What is it?** The "Final Human Check". After the PCB has gone through automated soldering and machine inspection, a human technician uses a microscope to ensure everything looks perfect. If a small solder bridge is found, they perform a "Touch-up" (repairing it with a soldering iron).
*   **Why does it exist?** AOI machines (Page 6) can sometimes have "False Passes" or "False Calls". A human expert is the ultimate authority on whether a solder joint is safe and reliable.

---

### 2. BUSINESS PURPOSE
*   **Elite Quality Assurance:** Catches subtle defects that machines might miss, like microscopic solder splashes or slight component tilting.
*   **Soldering Correction:** Provides a dedicated station for fixing "Soldering-only" defects discovered in the final stages.
*   **Shipment Readiness:** This is the "Exit Gate" of the SMT line. Once a board passes VI, it is considered a finished PCBA.
*   **What if it didn't exist?** Boards with weak solder joints might pass the electrical test but fail in the hands of the customer a few months later due to vibration.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **VI Technician** | Skilled in IPC-A-610 standards. Inspects and repairs boards. |
| **QA Inspector** | Performs "Gatekeeping" by randomly checking boards passed by the VI Technician. |

---

### 4. COMPLETE WORKFLOW
1.  **Target Selection:** System identifies boards that have **FAILED** at:
    *   Previous Soldering (Page 5)
    *   OR Post-Work Soldering (Page 7)
2.  **Physical Transport:** These "Soldering Failures" are brought to the VI station.
3.  **Scan:** Technician scans the serial number.
4.  **Action:**
    *   **PASS / FIXED:** Technician uses a soldering iron to fix the bridge/short, then marks it as PASS.
    *   **FAIL:** If the board cannot be touched up (e.g., burned PCB), it is marked as FAIL.
5.  **Database Update:** Record is saved with `process_step = 'VI / Touch Up'`.

---

### 5. UI SECTION EXPLANATION
*   **Theme:** Uses an "Orange/Sunset" theme, representing the precision work of manual soldering.
*   **Available Stats:** Tracks "Failed Soldering" boards specifically.
*   **Detail Table:**
    *   **FAIL REASON:** Shows the technician exactly what the machine or previous inspector found wrong.
    *   **Status Badges:** `✓ FIXED` (Green), `● FAIL` (Red), `🕒 PENDING` (Yellow).

---

### 6. DATABASE DESIGN
**Table:** `smt_inspections`

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `process_step` | VARCHAR | `VI / Touch Up` |
| `status` | VARCHAR | `PASS` (Fixed) or `FAIL` (Scrap) |
| `rework_reason`| TEXT | Description of the touch-up performed |

---

### 7. BACKEND LOGIC
*   **Specialized Filtering:** Unlike the general Rework page (Page 8), this page specifically filters for failures that happened during the *soldering* stages (`Previous Soldering`, `Post-Work Soldering`). It separates "Component Placement" errors from "Solder Joint" errors.

---

### 8. FRONTEND LOGIC
*   **QR Visibility:** Displays a large QR code in the table for every item. This is used by technicians to quickly re-scan the board if they need to check its history on a mobile tablet.
*   **Prompt-based Rework:** Uses a simple `window.prompt` to capture the failure reason, ensuring the operator doesn't have to navigate away from the scanning flow.

---

### 9. STATUS FLOW
1.  **SOLDER FAIL:** Board failed at a soldering stage.
2.  **PENDING:** Technician is currently looking at the board under the microscope.
3.  **FIXED:** Board is now perfect and ready for the next department.
4.  **SCRAP:** Board is unrepairable.

---

### 10. VALIDATION RULES
*   **Soldering-Only Gate:** The system will block a board if it failed at SPI (Solder Paste) because paste issues must be handled at the Rework station (Page 8), not the VI station.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Touch-up Signature:** Logs which technician performed the manual soldering. This is important for "Process Control"—if one technician's boards always fail later, they may need more soldering training.

---

### 12. ERROR SCENARIOS
*   **"Did not FAIL at any soldering stage":** Operator tried to scan a board that either passed everything or failed at a placement stage (AOI).

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A board comes out of the Reflow Oven with a "Solder Bridge" (two pins connected by accident) between two pins of a microcontroller.
*   **The Action:** The VI Technician uses a "Soldering Wick" to remove the extra solder, cleans the area with alcohol, and scans the board as **PASS / FIXED**.
*   **Mistake Prevention:** Ensures that every manual touch-up is documented, so engineers can track how much "Manual Labor" is going into each Work Order.

---

### 14. DEVELOPMENT CHALLENGES
*   **Complex Multi-Step Filtering:** Querying the database for failures across *multiple* potential previous steps (`Previous` OR `Post-Work`) while ignoring others.

---

### 15. FUTURE IMPROVEMENTS
*   **AI Visual Assistant:** Integrate a camera that highlights the defect area on the screen automatically based on the AOI coordinates.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** The "Microscope Station". A human expert fixes soldering mistakes.
*   **Quick Workflow:** Scan Solder-Failed Board -> Fix with Soldering Iron -> Mark as FIXED.
*   **Key Business Importance:** Ensures the highest possible soldering quality before shipping.
