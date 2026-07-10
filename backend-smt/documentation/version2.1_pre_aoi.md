# SMT Manufacturing Execution System (MES)

## VERSION 2.1: PRE AOI

- **Purpose of the page:** Logs inspection scans of boards before they enter reflow oven.
- **What this page is used for:** Registering pre-reflow inspection results, marking defect codes, tracking panel count, and reviewing scanning logs.
- **What has changed compared to Version 2.0:** Integrated the standardized searchable Work Order Selector and implemented role-gated record deletion.
- **What new features have been added:**
  - **Searchable Work Order selector:** Operator types to find target Work Order ID.
  - **Super Admin Delete Guard:** Blocks delete attempts by operators or supervisors, showing a descriptive Toast.
- **What improvements have been made:** Dropdown loading responsiveness and audit record security.
- **Any workflow changes:** Type to lookup Work Orders instead of manual scrolling.
- **Any validation improvements:** Added client-side validation on deletion permissions.
- **Any UI/UX improvements:** Custom styled glassmorphic combobox that expands automatically on click.
- **Any search or filtering improvements:** Prioritized fuzzy match sorting on Work Orders.
- **Any new business rules:** Deletion of Pre AOI logs is restricted exclusively to Super Admins.
- **Benefits for operators:** Quick queue lookup and less scroll latency.
- **Benefits for supervisors:** Ensures inspections are recorded against valid production runs.
- **Benefits for production:** Faster setup times during board changes.
- **Benefits for quality:** Secures audit histories from unauthorized alterations.
- **Benefits for traceability:** Matches Pre AOI scan records directly to the correct Work Order.
- **Overall outcome of the changes:** Enhanced pre-reflow security and search-friendly board inspection.
