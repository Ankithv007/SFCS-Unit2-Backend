import ExcelJS from 'exceljs';
import fs from 'fs';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('ExcelParserService');

export interface ParsedCell {
    columnNumber: number;
    c: number;
    columnLetter: string;
    rawValue: string | null;
    displayValue: string | null;
    v: string | null;
    dataType: string;
    t: string;
    isMerged: boolean;
    mergeType: 'MASTER' | 'SLAVE' | 'NONE';
    rowSpan: number;
    colSpan: number;
}

export interface ParsedRow {
    rowNumber: number;
    rowType: 'HEADER' | 'SUB_HEADER' | 'DATA' | 'BLANK';
    cells: ParsedCell[];
}

export interface ParsedMerge {
    rangeReference: string;
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
    rowSpan: number;
    colSpan: number;
}

export interface ParsedSheet {
    sheetName: string;
    totalRows: number;
    totalColumns: number;
    fileHash: string;
    fileSize: number;
    merges: ParsedMerge[];
    rows: ParsedRow[];
}

export const getColumnLetter = (colIndex: number): string => {
    let temp, letter = '';
    while (colIndex > 0) {
        temp = (colIndex - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        colIndex = Math.floor((colIndex - temp - 1) / 26);
    }
    return letter;
};

const getRangeBounds = (range: string): { startColumn: number; startRow: number; endColumn: number; endRow: number } | null => {
    // e.g. "A1:B2" -> { startColumn: 1, startRow: 1, endColumn: 2, endRow: 2 }
    const match = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!match) return null;

    const colToNum = (col: string) => {
        let num = 0;
        for (let i = 0; i < col.length; i++) {
            num = num * 26 + (col.charCodeAt(i) - 64);
        }
        return num;
    };

    return {
        startColumn: colToNum(match[1]),
        startRow: parseInt(match[2], 10),
        endColumn: colToNum(match[3]),
        endRow: parseInt(match[4], 10)
    };
};

export const calculateFileHash = async (filePath: string): Promise<{ hash: string; size: number }> => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        let size = 0;
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => {
            size += chunk.length;
            hash.update(chunk);
        });
        stream.on('end', () => resolve({ hash: hash.digest('hex'), size }));
        stream.on('error', err => reject(err));
    });
};

export const parseExcelFile = async (filePath: string): Promise<ParsedSheet> => {
    logger.info(`Starting dynamic parse of ${filePath}`);

    // Calculate SHA-256 hash and file size
    const { hash: fileHash, size: fileSize } = await calculateFileHash(filePath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    if (!workbook.worksheets || workbook.worksheets.length === 0) {
        throw new Error('Workbook contains no sheets.');
    }

    // Discover the active/first non-empty worksheet dynamically (do NOT hardcode sheet name)
    let worksheet = workbook.worksheets.find(ws => ws.state !== 'hidden' && (ws.rowCount > 0 || ws.actualRowCount > 0));
    if (!worksheet) {
        worksheet = workbook.worksheets[0];
    }

    if (!worksheet) {
        throw new Error('No valid data worksheet found in the uploaded workbook.');
    }

    const sheetName = worksheet.name;
    logger.info(`Dynamic sheet discovered: "${sheetName}"`);

    // Extract Merged Cells dynamically
    const merges: ParsedMerge[] = [];
    if ((worksheet as any).model && (worksheet as any).model.merges) {
        const rawMerges = (worksheet as any).model.merges as string[];
        for (const range of rawMerges) {
            const bounds = getRangeBounds(range);
            if (bounds) {
                const rowSpan = bounds.endRow - bounds.startRow + 1;
                const colSpan = bounds.endColumn - bounds.startColumn + 1;
                merges.push({
                    rangeReference: range,
                    startRow: bounds.startRow,
                    startColumn: bounds.startColumn,
                    endRow: bounds.endRow,
                    endColumn: bounds.endColumn,
                    rowSpan,
                    colSpan
                });
            }
        }
    }

    // Determine total rows and columns dynamically
    let totalRows = worksheet.actualRowCount || worksheet.rowCount || 0;
    let totalColumns = worksheet.actualColumnCount || worksheet.columnCount || 0;

    // Ensure we account for any columns or rows referenced in merged cells
    for (const m of merges) {
        if (m.endRow > totalRows) totalRows = m.endRow;
        if (m.endColumn > totalColumns) totalColumns = m.endColumn;
    }

    // Production RRH template has at least 32 columns and at least 2 header rows
    if (totalColumns < 32) {
        totalColumns = 32;
    }
    if (totalRows < 2) {
        throw new Error(`Excel format error: File must contain at least 2 header rows. Found ${totalRows} rows.`);
    }

    logger.info(`Detected dimensions for "${sheetName}": Total Rows = ${totalRows}, Total Columns = ${totalColumns}, Total Merges = ${merges.length}`);

    // Create merge lookup map for fast O(1) cell classification
    const mergeLookup = new Map<string, { merge: ParsedMerge; isMaster: boolean }>();
    for (const m of merges) {
        for (let r = m.startRow; r <= m.endRow; r++) {
            for (let c = m.startColumn; c <= m.endColumn; c++) {
                const key = `${r}:${c}`;
                const isMaster = (r === m.startRow && c === m.startColumn);
                mergeLookup.set(key, { merge: m, isMaster });
            }
        }
    }

    const parsedRows: ParsedRow[] = [];

    // Parse every physical row (1 to totalRows)
    for (let r = 1; r <= totalRows; r++) {
        const row = worksheet.getRow(r);
        let rowType: 'HEADER' | 'SUB_HEADER' | 'DATA' | 'BLANK' = 'DATA';
        if (r === 1) rowType = 'HEADER';
        else if (r === 2) rowType = 'SUB_HEADER';

        const cells: ParsedCell[] = [];
        let isRowEmpty = true;

        for (let c = 1; c <= totalColumns; c++) {
            const cell = row.getCell(c);
            let rawValue: string | null = null;
            let displayValue: string | null = null;
            let dataType = 'NULL';

            const mergeInfo = mergeLookup.get(`${r}:${c}`);
            const isMerged = !!mergeInfo;
            const mergeType: 'MASTER' | 'SLAVE' | 'NONE' = isMerged
                ? (mergeInfo.isMaster ? 'MASTER' : 'SLAVE')
                : 'NONE';
            const rowSpan = mergeInfo && mergeInfo.isMaster ? mergeInfo.merge.rowSpan : 1;
            const colSpan = mergeInfo && mergeInfo.isMaster ? mergeInfo.merge.colSpan : 1;

            if (cell.type !== ExcelJS.ValueType.Null && cell.value !== null && cell.value !== undefined) {
                isRowEmpty = false;

                try {
                    if (cell.type === ExcelJS.ValueType.Formula) {
                        dataType = 'FORMULA';
                        let res = cell.result;
                        if (res && typeof res === 'object' && 'error' in res) {
                            res = (res as any).error;
                        }
                        rawValue = res !== null && res !== undefined ? String(res) : '';
                        displayValue = rawValue;
                    } else if (cell.type === ExcelJS.ValueType.Date) {
                        dataType = 'DATE';
                        const d = cell.value as Date;
                        if (d instanceof Date && !isNaN(d.getTime())) {
                            rawValue = d.toISOString();
                            displayValue = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                        } else {
                            rawValue = String(cell.value);
                            displayValue = rawValue;
                        }
                    } else if (cell.type === ExcelJS.ValueType.Number) {
                        dataType = 'NUMBER';
                        // Use formatted text if available to preserve leading zeros (e.g. '001234')
                        if (cell.text && typeof cell.text === 'string' && cell.text.trim() !== '') {
                            displayValue = cell.text.trim();
                            rawValue = String(cell.value);
                        } else {
                            rawValue = String(cell.value);
                            displayValue = rawValue;
                        }
                    } else {
                        dataType = 'STRING';
                        // cell.text safely extracts rich text / plain text strings
                        const textVal = cell.text ? String(cell.text) : String(cell.value);
                        rawValue = textVal;
                        displayValue = textVal;
                    }
                } catch {
                    dataType = 'STRING';
                    rawValue = cell.text ? String(cell.text) : String(cell.value);
                    displayValue = rawValue;
                }
            } else if (mergeInfo && !mergeInfo.isMaster) {
                // If it's a slave cell in a merge, the display value is inherited from the master cell
                const masterCell = worksheet.getRow(mergeInfo.merge.startRow).getCell(mergeInfo.merge.startColumn);
                if (masterCell.value !== null && masterCell.value !== undefined) {
                    displayValue = masterCell.text ? String(masterCell.text) : String(masterCell.value);
                    rawValue = displayValue;
                    dataType = 'STRING';
                }
            }

            const colLetter = getColumnLetter(c);
            cells.push({
                columnNumber: c,
                c,
                columnLetter: colLetter,
                rawValue,
                displayValue,
                v: displayValue,
                dataType,
                t: dataType,
                isMerged,
                mergeType,
                rowSpan,
                colSpan
            });
        }

        if (isRowEmpty && rowType === 'DATA') {
            rowType = 'BLANK';
        }

        parsedRows.push({
            rowNumber: r,
            rowType,
            cells
        });
    }

    return {
        sheetName,
        totalRows,
        totalColumns,
        fileHash,
        fileSize,
        merges,
        rows: parsedRows
    };
};
