# SMT Manufacturing Execution System (MES)

## VERSION 2.1: REMOVED FEATURES / REMOVED PAGES

This document details the pages and features that have been removed or decommissioned in the Version 2.1 release.

### 1. SPI (SOLDER PASTE INSPECTION) SCANNING PAGE

- **Page or Feature Name:** SPI (Solder Paste Inspection) Scanning Page & Sidebar Link.
- **Reason for removal:** The SMT production pipeline layout was optimized to streamline manufacturing throughput. Maintaining a separate manual barcode scanning station for SPI created unnecessary physical bottlenecks and redundant scan entries.
- **What replaced it:** A direct logical transition from the Stencil Printing verification stage to the Pre AOI (Automated Optical Inspection) stage.
- **Impact on users:** Operators on the shop floor no longer need to perform manual barcode scans at a dedicated SPI station. The user interface navigation menu is simplified by removing the SPI page link.
- **Benefits of the removal:**
  - **Higher Throughput:** Eliminates the physical bottleneck at the SPI stage, speeding up the board-handling process.
  - **Reduced Scanning Overhead:** Operators scan less, saving time and lowering operator fatigue.
  - **Simpler UI:** Cleaner sidebar menu with one less step to monitor, reducing software clutter.
  - **Process Optimization:** Direct transition from Printing to Pre AOI maps closer to actual physical line movements.
