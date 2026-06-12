import path from 'path';
import fs from 'fs';
import * as ExcelJS from 'exceljs';
import { createLogger } from '../utils/logger';

const logger = createLogger('PO-Document-Service');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const ALLOWED_EXTENSIONS = ['.pdf', '.xls', '.xlsx'];

const BLOCKED_EXTENSIONS = [
    '.exe', '.bat', '.sh', '.js', '.php', '.py', '.pl', 
    '.cmd', '.msi', '.vbs', '.scr', '.com', '.htm', '.html'
];

/**
 * Resolves the uploads directory path.
 * Supports running inside Docker (where volume is mapped to /app/uploads)
 * and running in local development (falling back to parent directories).
 */
export const getUploadsDir = (): string => {
    if (process.env.UPLOADS_DIR) {
        return path.resolve(process.env.UPLOADS_DIR);
    }
    const dockerUploadsPath = path.join(process.cwd(), 'uploads');
    if (fs.existsSync(dockerUploadsPath)) {
        return dockerUploadsPath;
    }
    // Local fallback: c:\New-sfcs-unit2\SFCS-Unit2-Backend\backend-smt\src\services
    // up 4 directories: src -> backend-smt -> SFCS-Unit2-Backend -> c:\New-sfcs-unit2
    return path.join(__dirname, '../../../../uploads');
};

/**
 * Sanitizes the filename by removing spaces, path traversal markers, and special characters.
 */
export const sanitizeFilename = (filename: string): string => {
    const ext = path.extname(filename).toLowerCase();
    const base = path.basename(filename, ext);
    
    // Replace spaces and special characters with single underscores
    const sanitizedBase = base
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    return `${sanitizedBase}${ext}`;
};

interface UploadedFilePayload {
    name: string;
    type: string;
    data: string; // Base64 representation (data URL or raw base64)
}

interface SavedFileDetails {
    originalName: string;
    uniqueName: string;
    relativePath: string;
    absolutePath: string;
    mimeType: string;
}

/**
 * Validates, sanitizes, and saves the uploaded base64 PO document.
 */
export const savePoDocument = async (
    filePayload: UploadedFilePayload,
    workOrderId: string
): Promise<SavedFileDetails> => {
    const { name, type, data } = filePayload;

    if (!name || !type || !data) {
        throw new Error('Invalid upload payload: missing file name, type, or data');
    }

    // 1. Basic Extension Check
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new Error(`Unsupported file extension: ${ext}. Only PDF and Excel are allowed.`);
    }

    // 2. Dangerous Extension Validation
    if (BLOCKED_EXTENSIONS.includes(ext)) {
        throw new Error(`Dangerous file extension blocked: ${ext}`);
    }

    // 3. MIME Type Validation
    if (!ALLOWED_MIME_TYPES.includes(type)) {
        throw new Error(`Unsupported MIME type: ${type}. Only PDF and Excel files are allowed.`);
    }

    // 4. Decode base64 data to check size
    // Matches data URL pattern: data:application/pdf;base64,iVBORw0KGgoAAAANS...
    const matches = data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const base64Data = matches ? matches[2] : data;
    const fileBuffer = Buffer.from(base64Data, 'base64');

    if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new Error(`File exceeds maximum size limit of 5MB (Actual size: ${(fileBuffer.length / (1024 * 1024)).toFixed(2)}MB)`);
    }

    // 5. Create Target Directory
    const uploadsDir = getUploadsDir();
    const targetDir = path.join(uploadsDir, 'SMT-PO-Documents');
    if (!fs.existsSync(targetDir)) {
        logger.info(`Creating SMT PO Document upload directory: ${targetDir}`);
        fs.mkdirSync(targetDir, { recursive: true, mode: 0o755 });
    }

    // 6. Generate Unique Sanitized Name
    const timestamp = Math.floor(Date.now() / 1000);
    const sanitizedName = sanitizeFilename(name);
    const uniqueName = `${timestamp}_${sanitizedName}`;
    const absolutePath = path.join(targetDir, uniqueName);
    const relativePath = `SMT-PO-Documents/${uniqueName}`;

    // 7. Save File to Disk
    fs.writeFileSync(absolutePath, fileBuffer);
    logger.info(`Saved PO Document file successfully for WO ${workOrderId}: ${relativePath}`);

    return {
        originalName: name,
        uniqueName,
        relativePath,
        absolutePath,
        mimeType: type
    };
};

/**
 * Safely unlinks a file from disk given its database relative path.
 */
export const deletePoDocument = async (relativePath: string): Promise<boolean> => {
    try {
        if (!relativePath) return false;
        
        const uploadsDir = getUploadsDir();
        // Prevent path traversal outside the uploads directory
        const normalizedPath = path.normalize(relativePath).replace(/^(\.\.(\/|\\))+/, '');
        const absolutePath = path.join(uploadsDir, normalizedPath);

        // Ensure the path is within the uploads/SMT-PO-Documents directory
        const poDocsDir = path.join(uploadsDir, 'SMT-PO-Documents');
        if (!absolutePath.startsWith(poDocsDir)) {
            logger.warn(`Attempted delete path traversal blocked: ${absolutePath}`);
            return false;
        }

        if (fs.existsSync(absolutePath)) {
            fs.unlinkSync(absolutePath);
            logger.info(`Deleted PO document file from disk: ${absolutePath}`);
            return true;
        } else {
            logger.warn(`PO document file not found on disk: ${absolutePath}`);
            return false;
        }
    } catch (err: any) {
        logger.error(`Error deleting PO document file: ${err.message}`);
        return false;
    }
};

export interface ExcelPreviewData {
    type: 'excel' | 'legacy_excel';
    name: string;
    url?: string;
    columns?: string[];
    rows?: any[][];
}

/**
 * Parses Excel files using exceljs and returns preview details.
 * Limits row reading to first 100 rows.
 */
export const parseExcelPreview = async (
    relativePath: string,
    originalName: string,
    workOrderId: string
): Promise<ExcelPreviewData> => {
    const uploadsDir = getUploadsDir();
    const absolutePath = path.join(uploadsDir, relativePath);

    if (!fs.existsSync(absolutePath)) {
        throw new Error('Excel file not found on disk.');
    }

    // Legacy .xls is not supported by exceljs reader. Suggest direct download instead.
    if (originalName.toLowerCase().endsWith('.xls')) {
        return {
            type: 'legacy_excel',
            name: originalName,
            url: `/api/smt/work-orders/${workOrderId}/view-po-file`
        };
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(absolutePath);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
        throw new Error('Excel sheet is empty.');
    }

    const columns: string[] = [];
    const rows: any[][] = [];

    // Read headers from first row
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
        columns.push(cell.text || '');
    });

    // Read rows up to first 100 data rows (excluding header)
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        if (rowNumber > 101) return; // Limit to 100 data rows

        const rowData: any[] = [];
        for (let colNum = 1; colNum <= worksheet.columnCount; colNum++) {
            rowData.push(row.getCell(colNum).text || '');
        }
        rows.push(rowData);
    });

    return {
        type: 'excel',
        name: originalName,
        columns,
        rows
    };
};
