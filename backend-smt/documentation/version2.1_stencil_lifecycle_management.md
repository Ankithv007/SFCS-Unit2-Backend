# SMT Manufacturing Execution System (MES)

## VERSION 2.1: STENCIL LIFE CYCLE MANAGEMENT

- **Purpose of the page:** Tracks stencil print limit consumption and assigns stencils to work orders.
- **What this page is used for:** Registering stencil assignments to Work Orders, tracking print counts, calculating remaining prints, displaying lifetime warning banners, and logging historical assignments.
- **What has changed compared to Version 2.0:** Integrated the standardized searchable Work Order Selector, removed manual dropdown logic, and implemented role-gated record deletion.
- **What new features have been added:**
  - **Fuzzy-Searchable Work Order Selector:** Operators can type to quickly find the active Work Order ID.
  - **Super Admin Delete Guard:** Blocks delete attempts by operators or supervisors, showing a descriptive Toast.
- **What improvements have been made:** Dropdown responsiveness, memory cleanup (removed unused states), and warning banner visibility.
- **Any workflow changes:** Select target Work Orders by typing rather than scrolling.
- **Any validation improvements:** Added validation on delete permissions.
- **Any UI/UX improvements:** Custom combobox interface with auto-focus list.
- **Any search or filtering improvements:** Matches substring text within Work Orders.
- **Any new business rules:** Deletion of stencil lifecycle records is strictly restricted to Super Admins.
- **Benefits for operators:** Easy lookup of active queues.
- **Benefits for supervisors:** Ensures print logs are accurate and secure.
- **Benefits for production:** Faster changeover setups.
- **Benefits for quality:** Worn-out stencils are blocked from printing runs.
- **Benefits for traceability:** Accurate print limits mapped to Work Orders.
- **Overall outcome of the changes:** Error-free lifecycle management with optimized dropdown search and role-based deletion security.
