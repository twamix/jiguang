import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { downloadAndSaveIcon, getCachedIconPath, getTraditionalFaviconCandidates } from '@/lib/icon-downloader';
import { getUploadUrl } from '@/lib/upload-url';

export const dynamic = 'force-dynamic';

function getLocalUploadPath(iconUrl: string | null | undefined) {
    if (!iconUrl) return null;
    const cleanUrl = iconUrl.split('?')[0];
    const uploadPath = cleanUrl.startsWith('/api/uploads/')
        ? cleanUrl.replace(/^\/api/, '')
        : cleanUrl;

    if (!uploadPath.startsWith('/uploads/')) return null;

    return {
        publicUrl: uploadPath,
        filePath: path.join(process.cwd(), 'public', uploadPath.replace(/^\/+/, '')),
    };
}

function redirectToUpload(request: NextRequest, uploadUrl: string) {
    return NextResponse.redirect(new URL(getUploadUrl(uploadUrl), request.url), {
        status: 302,
        headers: {
            'Cache-Control': 'public, max-age=86400',
        },
    });
}

function serveCachedIcon(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
        '.avif': 'image/avif',
        '.bmp': 'image/bmp',
        '.gif': 'image/gif',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
    };

    return new NextResponse(fs.readFileSync(filePath), {
        headers: {
            'Content-Type': contentTypes[extension] || 'application/octet-stream',
            'Content-Length': fs.statSync(filePath).size.toString(),
            'Cache-Control': 'public, max-age=86400',
        },
    });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const site = await prisma.site.findUnique({ where: { id } });

    if (!site || !site.url || site.type === 'folder') {
        return NextResponse.json({ error: 'Icon not found' }, { status: 404 });
    }

    const cachedIcon = getCachedIconPath(site.id);
    if (cachedIcon) return serveCachedIcon(cachedIcon);

    const cachedCandidates = [site.customIconUrl, site.icon];
    for (const cachedUrl of cachedCandidates) {
        const localPath = getLocalUploadPath(cachedUrl);
        if (localPath && fs.existsSync(localPath.filePath)) {
            return redirectToUpload(request, localPath.publicUrl);
        }
    }

    const remoteCandidates = getTraditionalFaviconCandidates(site.url);

    const savedIcon = await downloadAndSaveIcon(site.id, remoteCandidates, { siteUrl: site.url });
    const downloadedIcon = savedIcon ? getCachedIconPath(site.id) : null;
    if (downloadedIcon) return serveCachedIcon(downloadedIcon);

    return NextResponse.json({ error: 'Icon not available' }, { status: 404 });
}
