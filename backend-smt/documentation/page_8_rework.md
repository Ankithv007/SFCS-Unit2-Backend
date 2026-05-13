# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 8: REWORK MANAGEMENT

### 1. PAGE NAME
**Rework Management**
*   **What is it?** This is the hospital for PCBs. Any board that fails an inspection (SPI or Post AOI) is sent here to be repaired by a skilled technician.
*   **Why does it exist?** SMT components are tiny and machines aren't perfect. Instead of throwing away a expensive board due to a single missing resistor, Rework allows the board to be "Saved" and returned to the production line.

---

### 2. BUSINESS PURPOSE
*   **Waste Reduction:** Directly reduces the "Scrap Rate" of the factory by recovering faulty boards.
*   **Yield Recovery:** Helps the factory achieve its production targets even when machines have issues.
*   **Quality Re-certification:** Ensures that a repaired board meets the same standards as a "First Pass" board.
*   **What if it didn't exist?** Every minor machine error would result in a discarded PCB, leading to millions in financial losses.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Rework Technician** | High-skill operator who performs the repair and logs the "PASS" result in MES. |
| **Debug Engineer** | Analyzes complex failures that the technician cannot fix. |
| **QA Auditor** | Re-inspects the board after rework to ensure the repair is perfect. |

---

### 4. COMPLETE WORKFLOW
1.  **Fail Event:** A board fails at SPI (Page 4) or Post AOI (Page 6).
2.  **MES Routing:** The board is automatically added to the **Rework Available** list for its specific Work Order.
3.  **Physical Transport:** The board is physically moved to the Rework Station.
4.  **Technician Action:**
    *   Technician scans the serial number.
    *   **MES Display:** The system shows the **Fail Reason** (e.g., "Bridge on U12") recorded by the inspector.
    *   Technician performs the repair (e.g., de-soldering and re-soldering).
5.  **Logging:**
    *   **PASS (REWORKED):** Board is fixed. It is now eligible to move to the next stage (e.g., AOI or Reflow).
    *   **FAIL:** Board is beyond repair or has a new defect. It stays in the Rework loop or is marked for Scrap.
6.  **Database Update:** Record is saved in `smt_inspections` with `process_step = 'rework'`.

---

### 5. UI SECTION EXPLANATION
*   **Theme:** Uses an "Amber/Yellow" theme (Industry standard for 'Warning' or 'Correction' areas).
*   **Rework Table:**
    *   **FAIL REASON Column:** Most important column—it tells the technician exactly what to fix so they don't waste time searching the whole board.
    *   **Status Badges:** `WAITING` (Not yet touched), `✓ REWORKED` (Fixed), `● RE-FAIL` (Failed again).
*   **Inline Reason Input:** If a board fails rework, a text box appears to record the *new* reason for failure.

---

### 6. DATABASE DESIGN
**Table:** `smt_inspections` (Transaction Log)

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `serial_id` | INTEGER | Link to the specific PCB |
| `process_step` | VARCHAR | `rework` |
| `status` | VARCHAR | `PASS` (Fixed) or `FAIL` (Still broken) |
| `rework_reason`| TEXT | The *original* reason (inherited) or the *new* failure reason |

---

### 7. BACKEND LOGIC
*   **Filtered Fetching:** The backend query uses `/api/smt/serial-numbers?filter_status=FAIL`. It specifically looks for the "Last Status" of the board across all SMT stages. If the last recorded event was a `FAIL`, it belongs in Rework.

---

### 8. FRONTEND LOGIC
*   **Dynamic Row Updates:** When the technician clicks "PASS", the frontend updates that specific row in the table immediately without refreshing the whole page. This maintains the operator's scroll position in a long list of failed boards.
*   **Debounce Guard:** Uses a `processingRef` to prevent "Double Scanning" errors if the operator's scanner triggers twice.

---

### 9. STATUS FLOW
1.  **FAIL (From SPI/AOI):** The entry point.
2.  **WAITING:** Board is physically at the rework station but work hasn't started.
3.  **PASS (REWORKED):** Board is "Resurrected" and returns to the normal flow.
4.  **RE-FAIL:** Board is sent back for a second round of repair or scrap.

---

### 10. VALIDATION RULES
*   **Existence Check:** You cannot scan a board into Rework if it has never failed an inspection.
*   **Reason Mandatory:** If marking as "FAIL" in Rework, a reason must be provided (Blocking logic).

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **The "Repair Stamp":** The system records who fixed the board and when. This is critical for medical or automotive electronics where rework is strictly regulated.

---

### 12. ERROR SCENARIOS
*   **"Barcode not found in rework list":** Operator tried to scan a "Good" board into the Rework station.
*   **"Already passed":** Operator scanned a board they already finished repairing.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A component is placed slightly crooked at the Pick & Place machine. AOI catches it.
*   **The Action:** The board appears in the Rework MES. The technician sees "Crooked Component at C10". They use a hot-air gun to realign C10. They scan the board and click **PASS**.
*   **Mistake Prevention:** Without the "Fail Reason" showing on screen, the technician might fix a crooked component at C10 but miss a short circuit at U5 that was also flagged.

---

### 14. DEVELOPMENT CHALLENGES
*   **Status Complexity:** A board can fail SPI, go to Rework, pass, then fail AOI, and go back to Rework. The logic must track the *entire history* and always show the *most recent* failure.

---

### 15. FUTURE IMPROVEMENTS
*   **Rework Statistics:** Create a chart showing which technician has the highest "Repair Success Rate".
*   **Instructional Videos:** Display a "How-to-Fix" video based on the specific defect code (e.g., if code = 'Bridge', show a video on bridge removal).

---

### 16. SIMPLE SUMMARY
*   **Explanation:** The "Repair Station". It shows what is broken and allows technicians to mark it as fixed.
*   **Quick Workflow:** Scan Failed Board -> See Error -> Fix Board -> Mark as PASS.
*   **Key Business Importance:** Saves money by recovering faulty products.
