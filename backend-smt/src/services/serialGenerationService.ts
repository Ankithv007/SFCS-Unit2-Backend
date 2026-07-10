import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import QRCode from 'qrcode';
import { getUploadsDir } from './qmsDocumentService';
import XLSX from 'xlsx';
import JSZip from 'jszip';

// Central uploads/laser-machine folder
export const getLaserUploadsDir = (): string => {
    const root = getUploadsDir();
    return path.join(root, 'laser-machine');
};

export interface FileProcessResult {
    originalSize: number;
    compressedSize: number;
    fileHash: string;
    compressedHash: string;
    savedPath: string;
    fileName: string;
    isCompressed: boolean;
}

/**
 * Parses and extracts all serial numbers from the uploaded file.
 * Handles Excel (.xlsx, .xls), CSV (.csv), plain text (.txt), ZIP (.zip), and PDF (.pdf).
 */
export async function parseSerialsFromFile(filePath: string, originalName: string): Promise<string[]> {
    const ext = path.extname(originalName).toLowerCase();
    const serials: string[] = [];

    const isHeader = (val: string) => {
        const lower = val.toLowerCase();
        return ['serial', 'serial number', 'serial_number', 'serials', 'sn', 'work order', 'workorder', 'wo', 'po', 'quantity', 'qty'].includes(lower);
    };

    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
        const workbook = XLSX.readFile(filePath);
        for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
            for (const row of data) {
                if (!Array.isArray(row)) continue;
                for (const cell of row) {
                    if (cell !== undefined && cell !== null) {
                        const val = String(cell).trim();
                        if (val && !isHeader(val)) {
                            serials.push(val);
                        }
                    }
                }
            }
        }
    } else if (ext === '.txt') {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const val = line.trim();
            if (val && !isHeader(val)) {
                serials.push(val);
            }
        }
    } else if (ext === '.zip') {
        const data = fs.readFileSync(filePath);
        const zip = await JSZip.loadAsync(data);
        for (const filename of Object.keys(zip.files)) {
            const file = zip.files[filename];
            if (!file.dir) {
                const buffer = await file.async('nodebuffer');
                const innerExt = path.extname(filename).toLowerCase();
                const tempInnerPath = path.join(path.dirname(filePath), `temp_inner_${Date.now()}_${path.basename(filename)}`);
                fs.writeFileSync(tempInnerPath, buffer);
                try {
                    const innerSerials = await parseSerialsFromFile(tempInnerPath, filename);
                    serials.push(...innerSerials);
                } finally {
                    try { fs.unlinkSync(tempInnerPath); } catch (e) {}
                }
            }
        }
    } else if (ext === '.pdf') {
        const buffer = fs.readFileSync(filePath);
        const content = buffer.toString('binary');
        const matches = content.match(/\(([^)]+)\)/g);
        if (matches) {
            for (const match of matches) {
                const text = match.slice(1, -1).trim();
                if (text.length >= 4 && text.length <= 50 && /^[A-Za-z0-9_-]+$/.test(text) && !isHeader(text)) {
                    serials.push(text);
                }
            }
        }
    }

    // Deduplicate and filter empty
    return Array.from(new Set(serials.map(s => s.trim()).filter(Boolean)));
}

/**
 * Validates file integrity, size, and magic bytes for PDF, ZIP, and Excel files.
 */
export async function checkFileIntegrity(filePath: string, originalName: string): Promise<boolean> {
    try {
        const stats = await fs.promises.stat(filePath);
        if (stats.size === 0) return false;

        const ext = path.extname(originalName).toLowerCase();
        const fd = await fs.promises.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(4);
            await fd.read(buffer, 0, 4, 0);

            if (ext === '.pdf') {
                // PDF magic: %PDF
                return buffer.toString('utf8').startsWith('%PDF');
            }
            if (ext === '.zip' || ext === '.xlsx') {
                // ZIP / XLSX magic: PK\x03\x04
                return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
            }
            if (ext === '.xls') {
                // XLS magic: D0 CF 11 E0
                return buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
            }
            // CSV / plain text has no single magic number, so we just accept it if non-empty
            return true;
        } finally {
            await fd.close();
        }
    } catch (err) {
        return false;
    }
}

/**
 * Formats numeric values to the configured serial number format, keeping leading zeros.
 */
export function formatSerialNumber(
    prefix: string | null,
    suffix: string | null,
    separator: string,
    num: number,
    startingNumberStr: string,
    numberLength: number | null
): string {
    const padLength = numberLength && numberLength > 0 
        ? numberLength 
        : startingNumberStr.length;

    const numStr = num.toString().padStart(padLength, '0');

    let sepChar = '';
    if (separator === 'Hyphen (-)') sepChar = '-';
    else if (separator === 'Underscore (_)') sepChar = '_';
    else if (separator === 'Slash (/)') sepChar = '/';
    else if (separator === 'Space') sepChar = ' ';

    const parts: string[] = [];
    if (prefix && prefix.trim()) parts.push(prefix.trim());
    parts.push(numStr);
    if (suffix && suffix.trim()) parts.push(suffix.trim());

    return parts.join(sepChar);
}

/**
 * Gzip compresses the file only if the compressed size is smaller than the original.
 * Saves the file inside: uploads/laser-machine/[YYYY]/[MM]/[BatchIdOrWoNumber]/[Filename]
 */
export async function compressAndSaveLaserMachineFile(
    tempFilePath: string,
    originalName: string,
    batchIdOrWoNumber: string
): Promise<FileProcessResult> {
    const now = new Date();
    const yyyy = now.getFullYear().toString();
    const mm = String(now.getMonth() + 1).padStart(2, '0');

    // Create target directory structure
    const targetDir = path.join(getLaserUploadsDir(), yyyy, mm, batchIdOrWoNumber);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const tempCompressedPath = `${tempFilePath}.gz`;

    try {
        // 1. Calculate original size and hash
        let originalSize = 0;
        const originalHashObj = crypto.createHash('sha256');
        const readStream = fs.createReadStream(tempFilePath);

        await new Promise<void>((resolve, reject) => {
            readStream.on('data', (chunk) => {
                originalSize += chunk.length;
                originalHashObj.update(chunk);
            });
            readStream.on('end', () => resolve());
            readStream.on('error', reject);
        });
        const fileHash = originalHashObj.digest('hex');

        // 2. Attempt Gzip compression to a temporary compressed file
        const compressReadStream = fs.createReadStream(tempFilePath);
        const writeCompressedStream = fs.createWriteStream(tempCompressedPath);
        const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });

        let compressedSize = 0;
        const compressedHashObj = crypto.createHash('sha256');
        const tracker = new Transform({
            transform(chunk, encoding, cb) {
                compressedSize += chunk.length;
                compressedHashObj.update(chunk);
                cb(null, chunk);
            }
        });

        await pipeline(compressReadStream, gzip, tracker, writeCompressedStream);
        const compressedHash = compressedHashObj.digest('hex');

        // 3. Determine if compression is beneficial
        const ext = path.extname(originalName);
        const isZip = ext.toLowerCase() === '.zip';

        // Never compress zip and skip compression if it does not save space
        if (isZip || compressedSize >= originalSize) {
            // Cleanup temp compressed file
            if (fs.existsSync(tempCompressedPath)) {
                await fs.promises.unlink(tempCompressedPath);
            }

            // Copy original uncompressed file to target destination
            const finalPath = path.join(targetDir, originalName);
            await fs.promises.copyFile(tempFilePath, finalPath);
            await fs.promises.unlink(tempFilePath);

            return {
                originalSize,
                compressedSize: originalSize,
                fileHash,
                compressedHash: fileHash,
                savedPath: finalPath,
                fileName: originalName,
                isCompressed: false
            };
        } else {
            // Move compressed file to target destination
            const compressedFilename = `${originalName}.gz`;
            const finalPath = path.join(targetDir, compressedFilename);
            await fs.promises.rename(tempCompressedPath, finalPath);
            await fs.promises.unlink(tempFilePath);

            return {
                originalSize,
                compressedSize,
                fileHash,
                compressedHash,
                savedPath: finalPath,
                fileName: compressedFilename,
                isCompressed: true
            };
        }
    } catch (err) {
        // Cleanup temp files on error
        if (fs.existsSync(tempFilePath)) {
            try { await fs.promises.unlink(tempFilePath); } catch (e) {}
        }
        if (fs.existsSync(tempCompressedPath)) {
            try { await fs.promises.unlink(tempCompressedPath); } catch (e) {}
        }
        throw err;
    }
}

/**
 * Generates a PNG Buffer of the QR Code for a given serial number.
 */
export async function generateQRCodeBuffer(text: string): Promise<Buffer> {
    return await QRCode.toBuffer(text, { margin: 2, width: 250 });
}

/**
 * Generates a Data URL (base64) of the QR Code.
 */
export async function generateQRCodeDataURL(text: string): Promise<string> {
    return await QRCode.toDataURL(text, { margin: 2, width: 200 });
}
