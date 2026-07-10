# SMT Manufacturing Execution System (MES)

## VERSION 2.1: SERIAL NUMBER GENERATION

- **Purpose of the page:** Registers or generates barcode labels for work orders before production begins on the shop floor.
- **What this page is used for:** Generating unique serial numbers for work orders, checking quantities, printing labels, and tracking registered serial queues.
- **What has changed compared to Version 2.0:** Integrated the new searchable Work Order Selector and added role-based deletion security.
- **What new features have been added:**
  - **Fuzzy-Searchable Work Order Selector:** Operators can type any part of the Work Order ID to immediately find it.
  - **Role-Gated Deletion:** Prevents standard operators and supervisors from deleting serial number generation logs.
- **What improvements have been made:** Upgraded the queue selector and hardened audit trail security.
- **Any workflow changes:** Select work orders by typing rather than scrolling.
- **Any validation improvements:** Added client-side role verification for record deletion.
- **Any UI/UX improvements:** Replaced native select drop-downs with a glassmorphic searchable combobox with auto-expanding suggestions.
- **Any search or filtering improvements:** Full fuzzy and substring matching on Work Orders.
- **Any new business rules:** Deletion of serial history is restricted exclusively to Super Admin users. Non-admin users receive a notification popup when attempting a delete.
- **Benefits for operators:** Faster search of active queues and fewer selection mistakes.
- **Benefits for supervisors:** Prevents accidental deletion of generated serial records.
- **Benefits for production:** Speeds up label setup times during new batch starts.
- **Benefits for quality:** Prevents serial duplication and protects scan logs.
- **Benefits for traceability:** Strict security on serial number history ensures data integrity.
- **Overall outcome of the changes:** A secure, quick-navigation barcode setup module.
