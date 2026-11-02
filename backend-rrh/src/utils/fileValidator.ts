import fs from 'fs';

/**
 * Validates that a file on disk has authentic image magic bytes.
 * Prevents disguised scripts, binaries, or polyglot files from being saved as images.
 */
export async function validateImageMagicBytes(filePath: string): Promise<boolean> {
    try {
        const buffer = Buffer.alloc(12);
        const fd = await fs.promises.open(filePath, 'r');
        await fd.read(buffer, 0, 12, 0);
        await fd.close();

        // JPEG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return true;
        }

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (
            buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
            buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
        ) {
            return true;
        }

        // WEBP: RIFF .... WEBP
        if (
            buffer.toString('ascii', 0, 4) === 'RIFF' &&
            buffer.toString('ascii', 8, 12) === 'WEBP'
        ) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}
