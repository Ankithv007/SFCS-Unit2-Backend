# Documentation: SMT Manufacturing Execution System (MES)

## PAGE 1: WORK ORDER MANAGEMENT

### 1. PAGE NAME
**Work Order Management (SMT)**
*   **What is it?** This is the "Master Setup" page where all production activities begin. It allows administrative or planning staff to define a specific production job (Work Order).
*   **Why does it exist?** In SMT manufacturing, production is never random. Every batch of PCBs produced must be tracked against a specific customer order, a specific model, and a specific quantity. This page creates the "identity" for a production run.

---

### 2. BUSINESS PURPOSE
*   **What business problem does it solve?** It solves the problem of uncontrolled production. Without Work Orders, the factory wouldn't know which product to run, on which line, or how many pieces are required.
*   **Importance in SMT:** SMT lines are expensive to set up. Knowing the Work Order details helps in material planning (Stencil, Solder Paste, Components) and labor scheduling.
*   **What if it didn't exist?** There would be no traceability. You wouldn't know when a batch started, who authorized it, or which PCBs belong to which customer. Quality issues would be impossible to trace back to the source.

---

### 3. USER ROLES
| Role | Permissions on this Page |
| :--- | :--- |
| **Production Planner** | Create new Work Orders, set priorities, and assign to specific lines. |
| **Supervisor** | View existing Work Orders and monitor production progress. |
| **Admin / Super Admin** | Full access, including the ability to delete Work Orders (restricted for data integrity). |
| **Operator** | View-only access (to see which job is next) or no access (depending on factory policy). |

---

### 4. COMPLETE WORKFLOW
1.  **User Access:** User logs into the SMT module and navigates to the "Work Order" page.
2.  **Form Entry:** User enters the **5-digit sequence number**. The system automatically prefixes it with the current date (e.g., `WO2026051300001`).
3.  **Parameter Definition:** User selects the **Line ID** (e.g., SMT-1) and **Priority** (High/Medium/Low).
4.  **Product Specification:** User enters the **Product Name** and **Description**.
5.  **Quantity Calculation:**
    *   User enters **Total Quantity** (Individual PCBs).
    *   User enters **PCB per Panel** (How many PCBs are on one large panel).
    *   **System Auto-Calculation:** The system calculates `Panel Quantity = Total Qty / PCB per Panel`.
6.  **Submission:** User clicks "Create Work Order".
7.  **Backend Validation:**
    *   Checks if the Work Order ID already exists.
    *   Validates all mandatory fields.
8.  **Database Persistence:** Records are saved in the `smt_work_orders` table.
9.  **Real-time Update:** The "Created Work Orders" table on the UI refreshes immediately to show the new entry.
10. **Activation:** The Work Order is now "Live" and becomes visible in the next production stages (Printing, Pre AOI, etc.).

---

### 5. UI SECTION EXPLANATION
*   **Work Order ID Input:** A combined field. The prefix (Date) is read-only. The user enters a 5-digit number. This prevents naming inconsistencies.
*   **Line ID Dropdown:** Selection of the physical SMT line (SMT-1, SMT-2, etc.).
*   **Priority Dropdown:** Color-coded (Red for High, Yellow for Medium, Blue for Low) to visually signal urgency to the floor.
*   **Quantity Fields:** Numeric inputs with logic to auto-calculate the number of panels needed.
*   **Created Work Orders Table:** An AG-Grid style table showing all historical and active orders with:
    *   **Description Cell:** A "Read More/Less" feature for long text.
    *   **Status Badges:** Visual indicators of priority.
    *   **Action Button (Delete):** Restricted to Super Admins.

---

### 6. DATABASE DESIGN
**Table Name:** `smt_work_orders`

| Column | Type | Purpose | Example |
| :--- | :--- | :--- | :--- |
| `id` | VARCHAR | Primary Key (Work Order Number) | `WO2024051300001` |
| `area_id` | VARCHAR | Identifies department | `SMT` |
| `line_id` | VARCHAR | Physical production line | `SMT-1` |
| `priority` | VARCHAR | Urgency level | `high` |
| `product_name` | VARCHAR | Name of the PCB | `Controller_v2.1` |
| `quantity` | INTEGER | Total PCBs required | `1000` |
| `panel_quantity`| INTEGER | Total Panels required | `500` (if 2 per panel) |
| `status` | VARCHAR | Current state of WO | `Created` |
| `created_by` | VARCHAR | Auditor ID | `Admin_Ankith` |
| `created_at` | TIMESTAMP | Time of creation | `2024-05-13 08:30:00` |

*   **Relationships:** One Work Order (Master) connects to many Serial Numbers (Detail).
*   **Data Integrity:** Foreign key constraints ensure that you cannot delete a Work Order if production has already started (Serial numbers exist).

---

### 7. BACKEND LOGIC
*   **API Endpoint:** `POST /api/smt/work-orders`
*   **Request Flow:** Frontend sends JSON payload -> Middleware checks authentication -> Controller validates data -> SQL Query executes -> Returns success/fail.
*   **Business Rules:**
    *   Work Order ID must be unique.
    *   Quantities must be positive integers.
*   **Transaction Handling:** If the database fails during save, the transaction rolls back to prevent partial data (Ghost records).

---

### 8. FRONTEND LOGIC
*   **Framework:** React with Functional Components.
*   **State Management:** `useState` for form fields; `useEffect` for auto-calculating panel quantities.
*   **Validation:** Regex used to ensure the sequence number is exactly 5 digits (`/^\d{5}$/`).
*   **Conditional Rendering:** The "Delete" button is only visible or clickable if the user has `Super Admin` privileges.

---

### 9. STATUS FLOW
1.  **Created:** Initial status when the form is submitted.
2.  **In Progress:** Changes automatically when the first Serial Number is scanned in production.
3.  **Completed:** Changes when the `scanned_qty` equals the `target_qty`.
4.  **Closed:** Manual status for archived orders.

---

### 10. VALIDATION RULES
*   **Mandatory:** All fields marked with `*` (ID, Product Name, Qty, Line) must be filled.
*   **Duplicate Prevention:** System checks `smt_work_orders` for the ID before saving.
*   **Type Check:** Ensures Quantity is a number, not text.
*   **Role Check:** Only authorized users can access the "Create" button.

---

### 11. AUDIT TRAIL / TRACEABILITY
*   **Created By:** Captures the ID of the person who created the order.
*   **Timestamp:** Captures the exact millisecond of creation.
*   **History:** Any deletion is logged (if the system has a delete-log table) or restricted.
*   **Traceability:** This ID follows every single PCB through the entire factory.

---

### 12. ERROR SCENARIOS
*   **Duplicate WO ID:** System shows a red alert: "Work Order ID already exists."
*   **Missing Fields:** "All fields are required" toaster notification appears.
*   **Server Offline:** A "Failed to connect to backend" error is handled via a try-catch block in the frontend.

---

### 13. REAL-TIME INDUSTRY SCENARIO
*   **Scenario:** A customer orders 500 units of a "Smart Home Hub".
*   **The Action:** The Planner opens this page, sets priority to "High" because the deadline is tomorrow, and assigns it to "SMT-1" which is currently idle.
*   **Mistake Prevention:** If the planner tries to enter -50 units by mistake, the system blocks the "Create" button, preventing a logic error in production.

---

### 14. DEVELOPMENT CHALLENGES
*   **ID Generation:** Combining date-based prefixes with user sequences while ensuring no two users create the same ID simultaneously. *Solution: Database-level Unique Constraint.*
*   **UI Layout:** Fitting 10+ columns into a table without making it unreadable. *Solution: Used a "DescriptionCell" component with Expand/Collapse logic.*

---

### 15. FUTURE IMPROVEMENTS
*   **ERP Integration:** Automatically fetching Work Orders from SAP/Oracle instead of manual entry.
*   **Attachment Support:** Ability to upload PCB Design (Gerber) files directly to the Work Order.
*   **Progress Bar:** Adding a live percentage bar in the table to show how much of the WO is finished.

---

### 16. SIMPLE SUMMARY
*   **Explanation:** This is the birth-place of a production job.
*   **Quick Workflow:** Enter ID -> Define Product & Qty -> Save -> Start Production.
*   **Business Importance:** It provides the "Who, What, Where, and How Many" for the entire factory.
