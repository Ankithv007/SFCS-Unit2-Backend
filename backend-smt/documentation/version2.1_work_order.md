# SMT Manufacturing Execution System (MES)

## VERSION 2.1: WORK ORDER MANAGEMENT

### 1. Introduction
The Work Order Management module is the central administrative starting point for all Surface Mount Technology (SMT) production lines. It serves as the primary entry point where planners register new manufacturing orders, define scheduling priorities, assign targeted physical assembly lines, and upload reference documents such as customer purchase orders. 

This page exists to establish a secure and authorized container—the Work Order ID—which acts as the root identifier for all subsequent shop-floor processes (including Stencil Printing, component mounting, Automated Optical Inspection, rework loops, and Finished Goods boxing). Without this container, downstream operators would have no valid references to scan barcodes against, risking uncoordinated and untraceable production. The primary users of this page are Production Planners, SMT Supervisors, and Line Managers who are responsible for scheduling, line setups, and order tracking.

---

### 2. Business Purpose
From a business operations perspective, the Work Order Management page is critical for establishing scheduling control and manufacturing discipline. 
* **Controlled Production Scheduling:** It prevents line operators from running unscheduled, unauthorized, or outdated product configurations, ensuring that only approved customer orders consume material.
* **Resource Optimization:** By assigning priority levels (High, Medium, Low) and designating specific physical lines (such as Line-1, Line-2, etc.), it enables supervisors to balance capacity and ensure that critical customer batches are expedited.
* **Traceability and Accountability:** Planners can associate every production run with the specific planner who authorized it.
* **Resource Waste Reduction:** By dynamically calculating the panel count based on the individual PCB counts and multiplier layout ratios, it prevents operator calculation errors, ensuring the warehouse issues exactly the required volume of raw substrates.

---

### 3. Previous Workflow (Version 2.0)
In Version 2.0, the Work Order page allowed basic creation of Work Orders and basic list filtering. However, users faced several challenges:
* **Obscure Audit Details:** The registration logs lacked structured display of creation stamps. Planners and supervisors could not easily see who generated or last verified a work order without scanning raw lists.
* **Poor Document Visibility:** Once a planner uploaded a Purchase Order (PO) document, there was no immediate visual indicator to show if a file was attached. Users had to open the edit screens to confirm if documentation was completed.
* **No Reporting Capabilities:** Operators and supervisors had no capability to print hard copies of the Work Order's parameters for physical folders or clipboard records on the line.

---

### 4. What's New in Version 2.1
Version 2.1 introduces several enhancements designed to improve visual clarity, document handling, and line compliance:
* **Detail Inspector Modal Layout:** Restructured the details view modal into clear, card-based blocks: Core Details, Production Details, PO Document Status, Audit Information, and Additional Information.
* **Real-time PO Attachment Indicators:** Added explicit status labels showing whether a customer PO document is attached, along with direct preview and download controls.
* **Detail Sheet Printing:** Introduced a dedicated "Print Details" capability inside the details view, allowing supervisors to generate clean, pre-formatted physical sheets for clipboard tracking.
* **Hardened Auditing Blocks:** Added a structured "Audit Information" card showing creator metadata and creation timestamps.

---

### 5. User Workflow
1. **Accessing the Module:** The planner logs into the SMT Portal and navigates to **SMT -> Work Order**.
2. **Reviewing Existing Orders:** The planner views the active Work Orders grid. High-priority orders are marked with high-visibility red badges.
3. **Registering a New Order:** The planner fills out the registration form:
   * Selects the physical target Line.
   * Chooses the Priority Level.
   * Enters Product Name and Description.
   * Input Target Quantity and PCB multiplier. The interface automatically calculates the Panel Quantity.
   * Uploads the customer PO document.
4. **Verifying Details:** The planner clicks the "Details" icon on any Work Order. The structured cards pop up:
   * Review core variables under **Production Details**.
   * Confirm the PO document is attached under **PO Document Status**.
   * Review audit stamps under **Audit Information**.
5. **Printing Clipboard Records:** The planner clicks **Print Details** to output a physical record for the line clipboard.
6. **Closing the Inspector:** The planner clicks **Close** to return to the active grid.

---

### 6. Benefits
* **Operator Benefits:** Clear layout views ensure that operator technicians know exactly how many panels are targeted for a run.
* **Production Benefits:** Dynamic panel calculators eliminate manual math mistakes.
* **Supervisor Benefits:** Printed detail sheets allow physical tracking on line clipboards.
* **QA Benefits:** Seamless access to uploaded customer PO documents ensures operators can verify build parameters against customer specifications.
* **Traceability Benefits:** Structured audit cards record the exact second a work order was generated and by whom.
* **Productivity Improvements:** Less administrative overhead when checking order setups.
* **Error Reduction:** Elimination of manual panel calculations prevents raw board shortages.
* **Time Savings:** Planners locate records and print physical forms in seconds.
* **Ease of Use:** Highly visual cards keep information readable for users.

---

### 7. User Experience Improvements
* **Easier to use:** Card layouts group related data points logically, reducing eye strain.
* **Faster:** Print controls are accessible directly within the details inspector.
* **More consistent:** Uses identical status styling and buttons as other SMT modules.
* **More reliable:** Prevents missing PO attachments by highlighting empty document states.
* **More user-friendly:** The modal window auto-formats to fit standard page print setups cleanly.

---

### 8. Summary
Version 2.1 transitions the Work Order Management module from a basic input form to an audit-ready administrative control center. By introducing card-based inspectors, document preview states, physical printing capability, and structured audit blocks, Version 2.1 ensures that supervisors, planners, and operators work with complete, secure, and easily verifiable production targets.
