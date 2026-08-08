# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 24: BARCODE SCANNER ENHANCEMENTS

### 1. PAGE NAME
**Barcode Scanner Configurations & Synchronous Focus Lock**
*   **What is it?** This page documents barcode scanner handling improvements, length-agnostic scanner configuration parameters, and the synchronous focus lock mechanism.
*   **Why does it exist?** It prevents operators from missing scans due to modal popups stealing cursor focus, ensuring hardware input integrity across SMT line stations.

---

### 2. BUSINESS PURPOSE
*   **Scanning Fluidity:** Locks browser cursor focus to the active barcode scanning input field, ignoring outside clicks or focus-stealing elements.
*   **Input Attribution Verification:** Distinguishes between physical laser scans and manual keyboard entries to track operator protocol compliance.
*   **What if it didn't exist?** Alerts, background refreshes, or manual clicks would move the cursor out of the scanning field. Subsequent rapid scans would be typed into empty space, causing unregistered boards.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Line Operator** | Uses the locked scanning interface during production runs; cannot toggle manual overrides. |
| **Supervisor** | Can authorize manual typing overrides when barcodes are physically damaged. |
| **Administrator** | Access to configure length thresholds and scan key listeners. |

---

### 4. COMPLETE WORKFLOW
1.  **Station Log-In:** The operator loads the SMT scanning interface (e.g. Printing).
2.  **Focus Lock Activation:** The frontend focus lock hook registers, constantly pulling cursor focus back to the target scanner input.
3.  **Physical Scan:** The operator scans a PCB panel.
4.  **Timing Analysis:** The key listener captures the character stream. Since character delays are below 15ms, the system marks the input source as `Laser`.
5.  **Submission & Verification:** The scan is validated, cleared, and the input field is re-focused immediately.

---

### 5. UI SECTION EXPLANATION
*   **Scanner Connection Status:** A green indicator light reading "Scanner Focus Locked" at the top of the interface.
*   **Active Scanning Field:** Input box with visual boundaries that cannot be unfocused.
*   **Manual Override Button:** Password-protected button allowing a supervisor to enable keyboard entry when a barcode is smudged.

---

### 6. DATABASE DESIGN
*   **Primary Reference:** `smt_serial_numbers` and verification scan logs.
*   **Source Column:** `barcode_source` (VARCHAR - e.g., 'Laser', 'Keyboard Override', 'Camera Scan') added to scan logs (migration `002`).

---

### 7. BACKEND LOGIC
*   **Controller:** `backend-smt/src/controllers/serialBatchController.ts`
*   **Payload Schema:** Accepts `barcode_source` in request bodies. Logs the source of the scan to the database to ensure full operator audit trails.

---

### 8. FRONTEND LOGIC
*   **Focus Lock Hook:** Uses React references (`useRef`) and document listeners:
    *   Attaches `blur` event listeners to the input field, running `inputRef.current.focus()` immediately if focus is lost.
    *   Exempts elements with CSS class `no-scanner-lock` (e.g. comments input box or search bars) to allow normal typing.
*   **Inter-Character Delay Filter:** Measures `performance.now()` stamps to verify entry speed.

---

### 9. STATUS FLOW
1.  **Active Lock:** Cursor is forced inside the scan input. Scanner is ready.
2.  **Exempt Mode:** Operator is editing a comment; scanner focus lock is temporarily paused.

---

### 10. VALIDATION RULES
*   **Speed Rule:** Character delays > 30ms are classified as keyboard typing, triggering supervisor validation checks if manual override is not unlocked.
*   **Regex Length rules:** Accepts alphanumeric strings matching length rules (length-agnostic configurations).

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Source Auditing:** Logs whether a board was registered via physical scanner or manually typed.
*   **Overriding Logger:** Saves the employee code of the supervisor who unlocked keyboard input for manual entries.

---

### 12. ERROR SCENARIOS
*   **Focus Lost Alert:** If the input field cannot regain focus. *System Alert: "Cursor focus lost. Please verify scanner connection."*
*   **Manual Typing Attempt:** Typing code without authorization. *System Alert: "Keyboard entry disabled. Use physical barcode scanner."*

---

### 13. REAL-TIME INDUSTRY SCENARIO
At the Pre-AOI station, a browser modal warning pops up about low printer stencil tension. The operator, focused on scanning boards, continues scanning panels. Without focus locks, the barcode character would type into the modal OK button or vanish. The focus lock hook intercepts the characters, keeps the cursor in the scan box, logs the board, and lets the operator close the modal afterwards.

---

### 14. DEVELOPMENT CHALLENGES
*   **Keyboard Conflict:** If the global focus lock is always active, the operator is unable to type remarks, search text, or enter login details.
*   **Solution:** Created a focus exemption system that inspects `document.activeElement` and suspends the lock loop if the active element has class name `no-scanner-lock` or is an input of type `password` or `text-area`.

---

### 15. FUTURE IMPROVEMENTS
*   **Audio Feedback:** Play distinct synth tones for "Scan Success" (high chime) and "Focus Lost" (error tone) through headphones.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** Hardware scanner listener system that enforces cursor focus on target scan boxes, preventing scan losses from popup interruptions, and auditing input source types.
*   **Commits:** `b34d5ec`
