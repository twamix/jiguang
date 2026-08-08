import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { downloadAndSaveIcon, getCachedIconPath, getTraditionalFaviconCandidates } from '@/lib/icon-downloader';
import fs from 'fs';
import path from 'path';
import { requireAdmin } from '@/lib/auth';


export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const unauthorized = await requireAdmin();
        if (unauthorized) return unauthorized;

        const body = await request.json().catch(() => ({}));
        const { siteIds, analyze } = body; // Add analyze flag

        const isAnalyzeMode = analyze === true;
        console.log(`[SyncAPI] Mode: ${isAnalyzeMode ? 'ANALYZE' : 'SYNC'}. Sites: ${siteIds?.length || 'ALL'}`);

        let sites;
        if (siteIds && Array.isArray(siteIds) && siteIds.length > 0) {
            sites = await prisma.site.findMany({
                where: { id: { in: siteIds } }
            });
        } else {
            sites = await prisma.site.findMany();
        }

        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;
        let toSyncCount = 0; // For analyze mode

        // Helper to check if file exists
        const publicDir = path.join(process.cwd(), 'public');

        // Process all sites (Batching mainly needed for downloads, but fine to keep for consistent logic)
        // If analyze mode, we can process faster, but keeping loop is simple.
        const BATCH_SIZE = analyze ? 50 : 5;

        for (let i = 0; i < sites.length; i += BATCH_SIZE) {
            const batch = sites.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (site: { id: string; url: string | null; iconType: string | null; icon: string | null }) => {
                let downloadUrls: string[] = [];
                let shouldDownload = false;

                const isAuto = site.iconType === 'auto' || !site.iconType;
                const isUpload = site.iconType === 'upload';
                const currentIcon = site.icon || ''; // Use site.icon, NOT customIconUrl

                if (site.url) {
                    try {
                        const faviconCandidates = getTraditionalFaviconCandidates(site.url);

                        if (isAuto) {
                            shouldDownload = !getCachedIconPath(site.id);
                            if (shouldDownload) downloadUrls = faviconCandidates;
                        } else if (isUpload) {
                            // Smart Repair Logic

                            // 1. If it's a remote Google URL (or other remote), we should cache it.
                            if (currentIcon.includes('google.com/s2/favicons') || currentIcon.startsWith('http')) {
                                downloadUrls = [currentIcon, ...faviconCandidates];
                                // Note: If it's a random http image, we might not be able to auto-download it easily without more logic.
                                // For safely, if it's google favicon, we know how to handle.
                                // If it's just http, we might want to leave it? 
                                // Let's stick to previous logic: if missing or google, fix it.
                                shouldDownload = true;
                            }
                            // 2. If it's a local file path, check if it exists
                            else if (currentIcon.startsWith('/uploads/')) {
                                // Remove query params for check
                                const cleanPath = currentIcon.split('?')[0];
                                const fullPath = path.join(publicDir, cleanPath.replace(/^\/+/, ''));
                                if (!fs.existsSync(fullPath)) {
                                    // File missing, download it again
                                    // Fallback to auto-favicon
                                    downloadUrls = faviconCandidates;
                                    shouldDownload = true;
                                }
                            }
                            // 3. If empty, download
                            else if (!currentIcon) {
                                downloadUrls = faviconCandidates;
                                shouldDownload = true;
                            }
                        }
                    } catch (e) { }
                }

                if (shouldDownload) {
                    if (analyze) {
                        toSyncCount++;
                    } else if (downloadUrls.length > 0) {
                        const result = await downloadAndSaveIcon(site.id, downloadUrls, {
                            storage: isUpload ? 'upload' : 'cache',
                            siteUrl: site.url || undefined
                        });
                        if (result) {
                            successCount++;
                        } else {
                            failCount++;
                        }
                    } else {
                        failCount++;
                    }
                } else {
                    skippedCount++;
                }
            }));
        }

        if (analyze) {
            return NextResponse.json({
                success: true,
                total: sites.length,
                skipped: skippedCount,
                toSync: toSyncCount
            });
        }

        return NextResponse.json({
            success: true,
            processed: successCount,
            successCount,
            failCount,
            skippedCount,
            total: sites.length
        });
    } catch (error) {
        console.error('Sync error:', error);
        return NextResponse.json({ error: 'Failed to sync icons' }, { status: 500 });
    }
}
