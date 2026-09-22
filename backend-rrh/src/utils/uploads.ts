import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';

const logger = createLogger('Uploads');

export const getUploadsDir = (): string => {
    if (process.env.UPLOADS_DIR) {
        return path.resolve(process.env.UPLOADS_DIR);
    }
    if (fs.existsSync('/app/uploads')) {
        return '/app/uploads';
    }
    let currentDir = __dirname;
    for (let i = 0; i < 6; i++) {
        const potentialUploads = path.join(currentDir, 'uploads');
        if (fs.existsSync(potentialUploads)) {
            return potentialUploads;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }
    return path.join(process.cwd(), 'uploads');
};

export const ensureUploadDirectoriesExist = () => {
    try {
        const uploadsDir = getUploadsDir();
        logger.info(`Centralized initialization in: ${uploadsDir}`);
        const subdirs = ['RRH-Work-Orders', 'temp'];
        subdirs.forEach(subdir => {
            const dirPath = path.join(uploadsDir, subdir);
            if (!fs.existsSync(dirPath)) {
                logger.info(`Creating required subdirectory: ${dirPath}`);
                fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
            }
        });
    } catch (err: any) {
        logger.error(`Upload directory initialization failed: ${err.message}`);
    }
};
