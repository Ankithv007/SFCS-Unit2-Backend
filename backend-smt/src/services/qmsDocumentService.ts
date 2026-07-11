import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

import { getUploadsDir } from '../utils/uploads';

const uploadsDir = getUploadsDir();

export const QMS_UPLOADS_DIR = path.join(uploadsDir, 'QMS-Data');
export const TEMP_UPLOADS_DIR = path.join(uploadsDir, 'temp');

// Ensure directories exist
if (!fs.existsSync(QMS_UPLOADS_DIR)) {
    fs.mkdirSync(QMS_UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
    fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
}

export interface FileProcessResult {
    originalSize: number;
    compressedSize: number;
    fileHash: string;
    compressedHash: string;
    savedPath: string;
    fileName: string;
}

/**
 * Generates a collision-safe, structured filename according to specifications.
 */
export function generateFileName(
    woNumber: string,
    docType: string,
    revision: string,
    userName: string,
    isReupload: boolean,
    originalName: string
): string {
    const cleanWo = woNumber.replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanDocType = docType.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    const cleanRev = revision.replace(/[^a-zA-Z0-9._-]/g, '');
    const cleanUser = userName.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
    
    const suffix = crypto.randomBytes(3).toString('hex');
    const ext = path.extname(originalName).toLowerCase();
    
    const reuploadStr = isReupload ? '_REUPLOAD' : '';
    
    if (ext === '.zip') {
        return `${cleanWo}_${cleanDocType}_${cleanRev}_${cleanUser}${reuploadStr}_${timestamp}_${suffix}${ext}`;
    } else {
        return `${cleanWo}_${cleanDocType}_${cleanRev}_${cleanUser}${reuploadStr}_${timestamp}_${suffix}${ext}.gz`;
    }
}

/**
 * Stream-processes an uploaded temp file:
 * - Calculates original size and original SHA256 hash.
 * - Compresses with gzip (unless isZip is true).
 * - Saves to final QMS directory.
 * - Calculates compressed size and compressed SHA256 hash.
 * - Deletes the temp file.
 */
export async function processUpload(
    tempFilePath: string,
    destFileName: string,
    isZip: boolean
): Promise<FileProcessResult> {
    const destPath = path.join(QMS_UPLOADS_DIR, destFileName);
    
    try {
        // 1. Calculate original file size and hash in a streaming pass
        let originalSize = 0;
        const originalHashObj = crypto.createHash('sha256');
        
        const readStream = fs.createReadStream(tempFilePath);
        await new Promise<void>((resolve, reject) => {
            readStream.on('data', (chunk) => {
                originalSize += chunk.length;
                originalHashObj.update(chunk);
            });
            readStream.on('end', () => resolve());
            readStream.on('error', (err) => reject(err));
        });
        const fileHash = originalHashObj.digest('hex');

        // 2. Perform compression/copy and calculate compressed hash in a pipeline pass
        const compressReadStream = fs.createReadStream(tempFilePath);
        const writeStream = fs.createWriteStream(destPath);
        
        let compressedSize = 0;
        const compressedHashObj = crypto.createHash('sha256');
        
        const hashAndSizeTracker = new Transform({
            transform(chunk: any, encoding: string, callback: Function) {
                compressedSize += chunk.length;
                compressedHashObj.update(chunk);
                callback(null, chunk);
            }
        });

        if (isZip) {
            // No compression, just copy and hash
            await pipeline(
                compressReadStream,
                hashAndSizeTracker,
                writeStream
            );
        } else {
            // Gzip compress stream
            const gzipStream = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
            await pipeline(
                compressReadStream,
                gzipStream,
                hashAndSizeTracker,
                writeStream
            );
        }

        const compressedHash = compressedHashObj.digest('hex');

        // Delete the temporary file safely
        await fs.promises.unlink(tempFilePath);

        return {
            originalSize,
            compressedSize,
            fileHash,
            compressedHash,
            savedPath: destPath,
            fileName: destFileName
        };
    } catch (error) {
        // Cleanup temp file in case of error
        if (fs.existsSync(tempFilePath)) {
            try {
                await fs.promises.unlink(tempFilePath);
            } catch (unlinkErr) {
                // Ignore unlink errors
            }
        }
        throw error;
    }
}
