import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { downloadAndSaveIcon, saveBase64Icon, deleteCachedIcon, deleteIcon, getTraditionalFaviconCandidates } from '@/lib/icon-downloader';
import { requireAdmin } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const unauthorized = await requireAdmin();
        if (unauthorized) return unauthorized;

        const body = await request.json();
        const siteId = typeof body.id === 'string' && body.id ? body.id : randomUUID();

        let initialIconType = body.iconType;
        let initialCustomIconUrl = body.customIconUrl;
        let shouldDownload = false;
        let downloadUrls: string[] = [];
        let downloadStorage: 'cache' | 'upload' = 'cache';

        // Logic: If auto, use Google Favicon URL initially.
        // If custom URL (http), use it.
        // If Base64, save to disk.

        if (body.iconType === 'auto' && body.url) {
            try {
                downloadUrls = getTraditionalFaviconCandidates(body.url);
                initialIconType = 'auto';
                initialCustomIconUrl = '';
                shouldDownload = true;
            } catch (e) { }
        } else if (body.iconType === 'upload' && body.customIconUrl) {
            if (body.customIconUrl.startsWith('http')) {
                downloadUrls = [body.customIconUrl];
                shouldDownload = true;
                downloadStorage = 'upload';
            } else if (body.customIconUrl.startsWith('data:image')) {
                // Handle Base64 Upload immediately
                const savedPath = await saveBase64Icon(siteId, body.customIconUrl);
                if (savedPath) {
                    initialCustomIconUrl = savedPath;
                }
            }
        }

        const site = await prisma.site.create({

            data: {
                id: siteId,
                name: body.name || 'New Site', // Ensure string
                // url removed here, handled at bottom
                desc: body.desc,
                category: body.category || 'Other', // Ensure string
                color: body.color,
                icon: body.icon,
                iconType: initialIconType,
                customIconUrl: initialCustomIconUrl,
                titleFont: body.titleFont,
                descFont: body.descFont,
                titleColor: body.titleColor,
                descColor: body.descColor,
                descSize: body.descSize ? parseInt(String(body.descSize)) : null,
                titleSize: body.titleSize ? parseInt(String(body.titleSize)) : null,
                order: body.order ? parseInt(String(body.order)) : 0,
                isHidden: Boolean(body.isHidden),
                type: body.type || 'site',
                parentId: body.parentId || null,
                url: body.url || (body.type === 'folder' ? '#' : ''), // Ensure string
            }
        });

        console.log(`[Sites API] Created ${site.type}: ${site.id} (${site.name})`);


        // Handle download - await it to ensure it completes, or log error
        // Note: In Vercel serverless this might still time out if too long, but for local/VPS it's better to await or use waitUntil
        if (shouldDownload && downloadUrls.length > 0) {
            console.log(`[Sites API] Triggering icon download for ${site.id} from ${downloadUrls.join(', ')}`);
            const localIcon = await downloadAndSaveIcon(site.id, downloadUrls, {
                storage: downloadStorage,
                siteUrl: downloadStorage === 'cache' ? site.url : undefined
            });
            if (localIcon) {
                return NextResponse.json(await prisma.site.findUnique({ where: { id: site.id } }));
            }
        }

        return NextResponse.json(site);
    } catch (error) {
        console.error('[Sites API] Create Site Error:', error);
        return NextResponse.json({
            error: 'Failed to create site',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const unauthorized = await requireAdmin();
        if (unauthorized) return unauthorized;

        const body = await request.json();
        // Console log strictly limited
        if (!Array.isArray(body)) {
            console.log('[Sites API] Single PUT:', JSON.stringify(body).substring(0, 200));
        }

        if (Array.isArray(body)) {
            // 串行更新，避免SQLite锁冲突
            for (const site of body) {
                await prisma.site.update({
                    where: { id: site.id },
                    data: {
                        order: site.order,
                        category: site.category,
                        isHidden: site.isHidden,
                        parentId: site.parentId
                    }
                });
            }
            return NextResponse.json({ success: true });
        }

        const existingSite = await prisma.site.findUnique({ where: { id: body.id } });
        if (!existingSite) {
            return NextResponse.json({ error: 'Site not found' }, { status: 404 });
        }

        let initialIconType = body.iconType;
        let initialCustomIconUrl = body.customIconUrl;
        let shouldDownload = false;
        let downloadUrls: string[] = [];
        let downloadStorage: 'cache' | 'upload' = 'cache';

        if (body.iconType === 'auto' && body.url) {
            try {
                initialIconType = 'auto';
                initialCustomIconUrl = '';
                const autoIconChanged = existingSite.url !== body.url || existingSite.iconType !== 'auto';
                if (autoIconChanged) {
                    deleteCachedIcon(body.id);
                    downloadUrls = getTraditionalFaviconCandidates(body.url);
                    shouldDownload = true;
                }
            } catch (e) { }
        } else if (body.iconType === 'upload' && body.customIconUrl) {
            if (body.customIconUrl.startsWith('http')) {
                if (!body.customIconUrl.startsWith('/uploads/')) {
                    downloadUrls = [body.customIconUrl];
                    shouldDownload = true;
                    downloadStorage = 'upload';
                }
            } else if (body.customIconUrl.startsWith('data:image')) {
                // Handle Base64 Upload
                const savedPath = await saveBase64Icon(body.id, body.customIconUrl);
                if (savedPath) {
                    initialCustomIconUrl = savedPath;
                }
            }
        }

        const site = await prisma.site.update({
            where: { id: body.id },
            data: {
                name: body.name,
                url: body.url,
                desc: body.desc,
                category: body.category,
                color: body.color,
                icon: body.icon,
                iconType: initialIconType,
                customIconUrl: initialCustomIconUrl,
                titleFont: body.titleFont,
                descFont: body.descFont,
                titleColor: body.titleColor,
                descColor: body.descColor,
                descSize: body.descSize ? parseInt(String(body.descSize)) : null,
                titleSize: body.titleSize ? parseInt(String(body.titleSize)) : null,
                order: body.order,
                isHidden: body.isHidden,
                type: body.type,
                parentId: body.parentId
            }
        });

        if (shouldDownload && downloadUrls.length > 0) {
            console.log(`[Sites API] Triggering icon download for ${site.id} from ${downloadUrls.join(', ')}`);
            const localIcon = await downloadAndSaveIcon(site.id, downloadUrls, {
                force: shouldDownload && downloadStorage === 'cache',
                storage: downloadStorage,
                siteUrl: downloadStorage === 'cache' ? site.url : undefined
            });
            if (localIcon) {
                return NextResponse.json(await prisma.site.findUnique({ where: { id: site.id } }));
            }
        }

        return NextResponse.json(site);
    } catch (error) {
        console.error('[Sites API] Update Site Error:', error);
        return NextResponse.json({ error: 'Failed to update site', details: String(error) }, { status: 500 });
    }
}



export async function DELETE(request: Request) {
    try {
        const unauthorized = await requireAdmin();
        if (unauthorized) return unauthorized;

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

        const deleteContents = searchParams.get('deleteContents') === 'true';

        const site = await prisma.site.findUnique({ where: { id } });
        if (site) {
            deleteCachedIcon(site.id);
            if (site.customIconUrl) {
                await deleteIcon(site.customIconUrl);
            }

            // Handle folder contents
            if (deleteContents) {
                // Delete all children (recursively? for now just children)
                const children = await prisma.site.findMany({ where: { parentId: id } });
                for (const child of children) {
                    deleteCachedIcon(child.id);
                    if (child.customIconUrl) await deleteIcon(child.customIconUrl);
                }
                await prisma.site.deleteMany({ where: { parentId: id } });
            } else {
                // Keep contents: Move to root (parentId = null)
                await prisma.site.updateMany({
                    where: { parentId: id },
                    data: { parentId: null }
                });
            }
        }

        await prisma.site.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to delete site' }, { status: 500 });
    }
}

export const dynamic = 'force-dynamic';
