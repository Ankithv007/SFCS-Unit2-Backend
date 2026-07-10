# SMT Manufacturing Execution System (MES)

## VERSION 2.1: STENCIL PRINTING

- **Purpose of the page:** Records board entry into the line by scanning panel barcodes and associating them with paste jars and stencils.
- **What this page is used for:** Registering paste solder printing scans, validating solder paste expiration, confirming stencil revision compliance, and logging printing runs.
- **What has changed compared to Version 2.0:** Integrated the standardized searchable Work Order Selector and implemented role-gated record deletion.
- **What new features have been added:**
  - **Fuzzy-Searchable Work Order Selector:** Operators can search by entering any subpart of a Work Order ID.
  - **Super Admin Delete Restriction:** Non-admin delete attempts are blocked and notified.
- **What improvements have been made:** Dropdown styling matching modern CSS themes, keyboard navigation, and audit security.
- **Any workflow changes:** Select Work Orders using fuzzy typeahead search.
- **Any validation improvements:** Added validation to check operator permission before removing print logs.
- **Any UI/UX improvements:** Sleek glassmorphic drop-down panel with auto-focus list.
- **Any search or filtering improvements:** Partial matched text sorting (Exact > Prefix > Substring).
- **Any new business rules:** Print records can only be deleted by Super Admins.
- **Benefits for operators:** Simplifies work order lookup when initiating runs.
- **Benefits for supervisors:** Protects active line print counts from unauthorized resets.
- **Benefits for production:** Minimizes line changeover delay.
- **Benefits for quality:** Secures verification histories against accidental deletions.
- **Benefits for traceability:** Guaranteed correlation between print logs and parent Work Orders.
- **Overall outcome of the changes:** Safe print log recording with standard combobox navigation.
