# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 5: PREVIOUS SOLDERING

### 1. PAGE NAME
**Previous Soldering**
*   **What is it?** This stage represents manual soldering or specific component placement/soldering that must happen *after* inspection but *before* the final high-temperature reflow oven.
*   **Why does it exist?** Some components are sensitive or need manual alignment that a machine can't handle. This page tracks that this "manual touch" was performed correctly.

---

### 2. BUSINESS PURPOSE
*   **Manual Process Control:** SMT is usually 100% automated. Any manual step is a high-risk area for human error. This page ensures every board gets the manual attention it needs.
*   **Status Gate:** Acts as a "Filter". It only allows boards that have passed **SPI** or **rework** to proceed.
*   **What if it didn't exist?** A board with a printing defect (SPI Fail) might accidentally have manual components added to it, wasting even more time and material.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Manual Soldering Operator** | Responsible for the physical soldering and scanning the board. |
| **Line Leader** | Verifies the quality of manual solder joints. |

---

### 4. COMPLETE WORKFLOW
1.  **Sequence Validation:** The system queries the database to find boards that have:
    *   Status = PASS at **SPI**
    *   OR Status = PASS at **rework**.
2.  **Scan:** Operator scans the PCB. 
3.  **Eligibility Check:** If the board hasn't passed SPI yet, the system blocks the scan with a Red Error.
4.  **Action:** After manual work is done, the operator clicks **PASS**.
5.  **Database Update:** Adds a record to `smt_inspections` with `process_step = 'Previous Soldering'`.

---

### 5. UI SECTION EXPLANATION
*   **Eligibility Note:** The UI clearly states: "Scan barcode (must have passed SPI/AOI/rework)".
*   **Operator Input:** Captures the name of the person doing the manual work (for accountability).
*   **Stats Dashboard:** 
    *   **Available:** Boards that are eligible (passed SPI).
    *   **Completed:** Boards that have finished this manual step.

---

### 6. DATABASE DESIGN
**Table:** `smt_inspections` (Shared with other stages)

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `process_step` | VARCHAR | `Previous Soldering` |
| `status` | VARCHAR | `PASS` or `FAIL` |

---

### 7. BACKEND LOGIC
*   **Strict Sequencing Filter:** The API for fetching serials for this page uses a SQL `filter_step` parameter: `/api/smt/serial-numbers?filter_step=SPI,Post AOI,rework&filter_status=PASS`. This is the "Hard Gate" logic.

---

### 8. FRONTEND LOGIC
*   **Dynamic Filtering:** The frontend only displays boards that meet the "Pre-requisite" criteria, preventing the operator from seeing or scanning irrelevant boards.

---

### 9. STATUS FLOW
1.  **ELIGIBLE:** Board has passed SPI but hasn't been scanned here yet.
2.  **PASSED:** Board has completed the manual soldering step and is ready for the next stage.

---

### 10. VALIDATION RULES
*   **Hard Sequence Gate:** You cannot skip SPI. The backend will return a `400 Bad Request` if you try to mark a board as PASSED in Previous Soldering if it hasn't passed SPI.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Operator Accountability:** Manual soldering is the most likely place for "Cold Solder" or "Shorts". Tracking the operator ID allows for targeted training if quality issues are found later.

---

### 12. ERROR SCENARIOS
*   **"Not ready for this stage":** Most common error. Means the board failed SPI or was never scanned at SPI.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A large capacitor needs to be manually soldered because it’s too heavy for the Pick & Place machine.
*   **The Action:** The operator solders the capacitor and then scans the board. The system confirms the board passed SPI (meaning the paste under the capacitor is good).
*   **Mistake Prevention:** Prevents soldering a component onto a board that has no solder paste (SPI Fail).

---

### 14. DEVELOPMENT CHALLENGES
*   **Complex Pre-requisites:** Some boards might come from SPI, others from a Rework station. *Solution: The "OR" logic in the SQL query handles multiple eligible previous steps.*

---

### 15. FUTURE IMPROVEMENTS
*   **Visual Aid:** Display a photo of the manual soldering area on the screen to guide the operator on exactly where to solder.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** The "Check-in" for manual work.
*   **Quick Workflow:** Confirm board passed SPI -> Perform manual soldering -> Scan to PASS.
*   **Key Business Importance:** Ensures manual steps are synchronized with automated inspections.
