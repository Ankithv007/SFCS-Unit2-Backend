# SMT Manufacturing Execution System (MES)

## VERSION 2.1: REWORK STAGE

- **Purpose of the page:** Tracks defective boards sent from Post AOI and records rework repairs and re-inspection results.
- **What this page is used for:** Viewing pending rework boards, recording rework actions (e.g. component replacement), logging re-inspection status, and maintaining historical logs.
- **What has changed compared to Version 2.0:** Integrated the standardized searchable Work Order Selector and implemented role-gated record deletion.
- **What new features have been added:**
  - **Fuzzy-Searchable Work Order Selector:** Operators can type to quickly find the active Work Order ID.
  - **Super Admin Delete Guard:** Blocks delete attempts by operators or supervisors, displaying an informative Toast.
- **What improvements have been made:** Dropdown responsiveness and logging safety.
- **Any workflow changes:** Select target Work Orders by typing rather than scrolling.
- **Any validation improvements:** Role checks for delete actions.
- **Any UI/UX improvements:** Custom combobox interface with auto-focus list.
- **Any search or filtering improvements:** Matches substring text within Work Orders.
- **Any new business rules:** Deletion of rework history logs is strictly restricted to Super Admins.
- **Benefits for operators:** Easy lookup of active queues.
- **Benefits for supervisors:** Ensures defect-to-resolution cycle logs are accurate and secure.
- **Benefits for production:** Faster queue switches during batch changeovers.
- **Benefits for quality:** Hardens rework records from tampering or accidental deletions.
- **Benefits for traceability:** Bulletproof defect histories.
- **Overall outcome of the changes:** Safe, auditable rework loop with standard combobox navigation.
