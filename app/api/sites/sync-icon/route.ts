import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { downloadAndSaveIcon, getTraditionalFaviconCandidates } from '@/lib/icon-downloader';
import { requireAdmin } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const unauthorized = await requireAdmin();
        if (unauthorized) return unauthorized;

        const { siteId } = await request.json();

        if (!siteId) {
            return NextResponse.json({ error: 'Site ID is required' }, { status: 400 });
        }

        const site = await prisma.site.findUnique({
            where: { id: siteId },
        });

        if (!site || !site.url) {
            return NextResponse.json({ error: 'Site not found or has no URL' }, { status: 404 });
        }

        let downloadUrls: string[] = [];
        try {
            downloadUrls = getTraditionalFaviconCandidates(site.url);
        } catch (e) {
            return NextResponse.json({ error: 'Invalid Site URL' }, { status: 400 });
        }

        // Trigger download
        const result = await downloadAndSaveIcon(site.id, downloadUrls, { force: true, siteUrl: site.url });

        if (!result) {
            console.error(`[Sync API] Failed to download icon for site ${site.id} from ${downloadUrls.join(', ')}`);
            return NextResponse.json({ error: 'Failed to download icon' }, { status: 500 });
        }

        return NextResponse.json({ success: true, url: result });
    } catch (error) {
        console.error('Sync icon error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

export const dynamic = 'force-dynamic';
