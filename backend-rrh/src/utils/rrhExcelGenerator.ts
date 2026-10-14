import ExcelJS from 'exceljs';
import { Response } from 'express';
import { createLogger } from './logger';

const logger = createLogger('RrhExcelGenerator');

export interface RrhExcelReportOptions {
    title: string;
    stageName: string;
    route?: string;
    operatorName?: string;
    workOrder: {
        id: string;
        date?: string | Date | null;
        quantity?: number | string | null;
        lotNumber?: string | null;
        status?: string | null;
    };
    session?: {
        id?: number | string;
        status?: string | null;
        createdBy?: string | null;
        createdAt?: string | Date | null;
    };
    productionSummary?: {
        total?: number;
        passed?: number;
        failed?: number;
        pending?: number;
        yieldPercent?: string;
    };
    section4Title?: string;
    columns: Array<{
        header: string;
        key: string;
        width?: number;
        align?: 'left' | 'center' | 'right';
    }>;
    rows: Array<Record<string, any>>;
    sheetName?: string;
}

export function buildRrhSessionExcel(options: RrhExcelReportOptions): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Velankani SFCS';
    workbook.created = new Date();

    const sheetName = options.sheetName || 'Session Report';
    const ws = workbook.addWorksheet(sheetName, {
        views: [{ showGridLines: true }]
    });

    // Color definitions matching SMT Post AOI standard
    const NAVY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    const BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    const TEAL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
    const INDIGO: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    const PLUM: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    const GREEN: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
    const RED_BANNER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
    const LIGHT_GRAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    const WHITE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    const WHITE_FONT = { name: 'Calibri', size: 10, color: { argb: 'FFFFFFFF' }, bold: true };
    const DARK_FONT = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
    const BOLD_DARK = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' }, bold: true };

    const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };

    // Determine total number of columns (minimum 7, or matching defined columns)
    const numCols = Math.max(7, options.columns.length);
    const endColLetter = String.fromCharCode(64 + Math.min(26, numCols));

    // Column widths setup
    ws.columns = options.columns.map((col, idx) => ({
        key: col.key || `col_${idx}`,
        width: col.width || 20
    }));

    const addSectionHeader = (label: string, fill: ExcelJS.Fill, startRow: number) => {
        const row = ws.getRow(startRow);
        row.height = 22;
        const cell = ws.getCell(`A${startRow}`);
        cell.value = label;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = fill;
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.mergeCells(`A${startRow}:${endColLetter}${startRow}`);
    };

    const addKVRow = (rowNum: number, label: string, value: any) => {
        const row = ws.getRow(rowNum);
        row.height = 19;
        ws.mergeCells(`A${rowNum}:B${rowNum}`);
        const lCell = ws.getCell(`A${rowNum}`);
        lCell.value = label;
        lCell.font = BOLD_DARK;
        lCell.fill = LIGHT_GRAY;
        lCell.border = thinBorder;
        lCell.alignment = { vertical: 'middle', indent: 1 };

        ws.mergeCells(`C${rowNum}:${endColLetter}${rowNum}`);
        const vCell = ws.getCell(`C${rowNum}`);
        vCell.value = (value !== null && value !== undefined && value !== '') ? String(value) : '-';
        vCell.font = DARK_FONT;
        vCell.fill = WHITE_FILL;
        vCell.border = thinBorder;
        vCell.alignment = { vertical: 'middle', indent: 1 };
    };

    const fmtDate = (d: any) => {
        if (!d) return '-';
        try {
            return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
        } catch {
            return String(d);
        }
    };

    const fmtDateOnly = (d: any) => {
        if (!d) return '-';
        try {
            if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
            return new Date(d).toLocaleDateString('en-IN');
        } catch {
            return String(d);
        }
    };

    let r = 1;

    // ─── TITLE BANNER ─────────────────────────────────────────
    ws.getRow(r).height = 38;
    const titleCell = ws.getCell(`A${r}`);
    titleCell.value = options.title.startsWith('🏭') ? options.title : `🏭  ${options.title}`;
    titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    
    const isFailedTitle = options.title.toLowerCase().includes('fail');
    titleCell.fill = isFailedTitle ? RED_BANNER : NAVY;
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.mergeCells(`A${r}:${endColLetter}${r}`);
    r++;

    // ─── SUBTITLE BAR ─────────────────────────────────────────
    ws.getRow(r).height = 18;
    const subCell = ws.getCell(`A${r}`);
    const routeText = options.route ? `  |  Route: ${options.route}` : '';
    subCell.value = `Stage: ${options.stageName}${routeText}  |  Generated: ${fmtDate(new Date())}  |  Generated By: ${options.operatorName || 'System Admin'}`;
    subCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FFCBD5E1' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.mergeCells(`A${r}:${endColLetter}${r}`);
    r++;

    r++; // Spacer

    // ─── SECTION 1: WORK ORDER DETAILS ─────────────────────────
    addSectionHeader('  1.  WORK ORDER DETAILS', BLUE, r); r++;
    addKVRow(r, 'Work Order Number', options.workOrder.id); r++;
    addKVRow(r, 'Work Order Date', fmtDateOnly(options.workOrder.date)); r++;
    addKVRow(r, 'Work Order Quantity', options.workOrder.quantity ?? '-'); r++;
    addKVRow(r, 'Lot Number / Batch', options.workOrder.lotNumber ?? '-'); r++;
    addKVRow(r, 'Work Order Status', options.workOrder.status || 'Active'); r++;

    r++; // Spacer

    // ─── SECTION 2: SESSION DETAILS ───────────────────────────
    addSectionHeader(`  2.  ${options.stageName.toUpperCase()} SESSION DETAILS`, INDIGO, r); r++;
    addKVRow(r, 'Station Name', options.stageName); r++;
    if (options.route) {
        addKVRow(r, 'Workflow Route', options.route); r++;
    }
    if (options.session) {
        addKVRow(r, 'Session Started By', options.session.createdBy || options.operatorName || '-'); r++;
        addKVRow(r, 'Session Started Date & Time', fmtDate(options.session.createdAt)); r++;
        addKVRow(r, 'Session Status', options.session.status || 'In Progress'); r++;
    }

    r++; // Spacer

    // ─── SECTION 3: PRODUCTION SUMMARY ────────────────────────
    if (options.productionSummary) {
        const ps = options.productionSummary;
        addSectionHeader('  3.  PRODUCTION SUMMARY', PLUM, r); r++;
        addKVRow(r, 'Work Order Quantity', ps.total ?? options.workOrder.quantity ?? '-'); r++;
        addKVRow(r, 'Passed Quantity', ps.passed ?? 0); r++;
        addKVRow(r, 'Yield (%)', ps.yieldPercent ?? '0.00%'); r++;
        addKVRow(r, 'Failed Quantity', ps.failed ?? 0); r++;
        addKVRow(r, 'Pending Quantity', ps.pending ?? 0); r++;

        r++; // Spacer
    }

    // ─── SECTION 4: SCAN HISTORY TABLE ────────────────────────
    const secNumber = options.productionSummary ? '4' : '3';
    const secTitle = options.section4Title || 'SCAN HISTORY';
    addSectionHeader(`  ${secNumber}.  ${secTitle}`, GREEN, r); r++;

    const hRow = ws.getRow(r);
    hRow.height = 20;
    options.columns.forEach((col, i) => {
        const colLetter = String.fromCharCode(65 + i);
        const cell = ws.getCell(`${colLetter}${r}`);
        cell.value = col.header;
        cell.font = WHITE_FONT;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    r++;

    if (options.rows.length === 0) {
        const emptyRow = ws.getRow(r);
        emptyRow.height = 20;
        const cell = ws.getCell(`A${r}`);
        cell.value = 'No scan records found for this export filter.';
        cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(`A${r}:${endColLetter}${r}`);
        r++;
    } else {
        options.rows.forEach((rowObj, idx) => {
            const dataRow = ws.getRow(r);
            dataRow.height = 18;
            const rowFill: ExcelJS.Fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' }
            };

            options.columns.forEach((col, cIdx) => {
                const colLetter = String.fromCharCode(65 + cIdx);
                const cell = ws.getCell(`${colLetter}${r}`);
                const val = rowObj[col.key];

                cell.value = (val !== null && val !== undefined && val !== '') ? val : '-';
                cell.font = DARK_FONT;
                cell.fill = rowFill;
                cell.border = thinBorder;
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: col.align || (cIdx === 0 ? 'center' : 'left'),
                    indent: (col.align === 'center' || cIdx === 0) ? 0 : 1,
                    wrapText: true
                };

                // Badge styling for status
                if (col.key === 'status' || col.key === 'result') {
                    const statusStr = String(val || '').trim().toUpperCase();
                    const isPass = statusStr === 'PASS' || statusStr === 'COMPLETED';
                    const isFail = statusStr === 'FAIL' || statusStr === 'FAILED';
                    cell.font = {
                        name: 'Calibri',
                        size: 10,
                        bold: true,
                        color: { argb: isPass ? 'FF166534' : isFail ? 'FF991B1B' : 'FF92400E' }
                    };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: isPass ? 'FFDCFCE7' : isFail ? 'FFFEE2E2' : 'FFFEF3C7' }
                    };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }
            });
            r++;
        });
    }

    r++; // Spacer

    // ─── FOOTER NOTE ──────────────────────────────────────────
    const footerCell = ws.getCell(`A${r}`);
    footerCell.value = `Report generated by Velankani SFCS RRH System  |  ${options.operatorName || 'System Admin'}  |  ${fmtDate(new Date())}`;
    footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
    ws.mergeCells(`A${r}:${endColLetter}${r}`);

    return workbook;
}

export async function sendRrhSessionExcel(res: Response, filename: string, options: RrhExcelReportOptions): Promise<void> {
    try {
        // Yield to Node event loop before CPU-heavy workbook building so pending scan queries don't starve
        await new Promise((resolve) => setImmediate(resolve));
        const workbook = buildRrhSessionExcel(options);
        await new Promise((resolve) => setImmediate(resolve));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[/\\?%*:|"<>]/g, '_')}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error(`Error generating RRH session Excel (${filename}): ${err.message}`);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Failed to generate Excel report.', error: err.message });
        }
    }
}
