import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';

const DEFAULT_ICON_PATH = path.join(process.cwd(), 'app', 'icon.png');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const MAX_FAVICON_SIZE = 5 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
};

function readLocalIcon(iconUrl: string) {
    const cleanUrl = iconUrl.split('?')[0];
    const publicUrl = cleanUrl.startsWith('/api/uploads/')
        ? cleanUrl.replace(/^\/api/, '')
        : cleanUrl;

    if (!publicUrl.startsWith('/') || publicUrl.includes('..')) return null;

    const filePath = path.resolve(PUBLIC_DIR, publicUrl.replace(/^\/+/, ''));
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return null;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;

    return {
        body: fs.readFileSync(filePath),
        contentType: MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    };
}

function decodeDataIcon(iconUrl: string) {
    const match = iconUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match) return null;

    const body = Buffer.from(match[2], 'base64');
    if (!body.length || body.length > MAX_FAVICON_SIZE) return null;

    return { body, contentType: match[1].toLowerCase() };
}

function readDefaultIcon() {
    return {
        body: fs.readFileSync(DEFAULT_ICON_PATH),
        contentType: 'image/png',
    };
}

export async function getSiteFavicon() {
    try {
        const settings = await prisma.globalSettings.findUnique({ where: { id: 1 } });
        const config = settings?.config ? JSON.parse(settings.config) : null;
        const logoImage = typeof config?.logoImage === 'string' ? config.logoImage.trim() : '';

        if (logoImage) {
            const configuredIcon = logoImage.startsWith('data:image/')
                ? decodeDataIcon(logoImage)
                : readLocalIcon(logoImage);
            if (configuredIcon) return configuredIcon;
        }
    } catch (error) {
        console.error('Failed to load configured favicon:', error);
    }

    return readDefaultIcon();
}
