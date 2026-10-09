import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';
import { mkdir } from 'fs/promises';
import { assertPublicHttpUrl } from './safe-url';

const CACHED_ICONS_DIR = path.join(process.cwd(), 'data', 'icons');
const UPLOADED_ICONS_DIR = path.join(process.cwd(), 'public', 'uploads', 'icons');
const MAX_ICON_REDIRECTS = 3;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const ICON_EXTENSIONS = ['png', 'jpg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'];
const iconDownloads = new Map<string, Promise<string | null>>();

const FAVICON_PROVIDERS = [
    (domain: string) => `https://favicon.im/${domain}?larger=true`,
    (domain: string) => `https://unavatar.io/${domain}?fallback=false`,
    (domain: string) => `https://api.iowen.cn/favicon/${domain}.png`,
    (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
];

// Ensure upload directory exists
if (!fs.existsSync(CACHED_ICONS_DIR)) {
    fs.mkdirSync(CACHED_ICONS_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADED_ICONS_DIR)) {
    fs.mkdirSync(UPLOADED_ICONS_DIR, { recursive: true });
}

async function fetchIcon(
    iconUrl: string,
    options: { accept?: string; destination?: 'document' | 'image' } = {}
) {
    let safeUrl = await assertPublicHttpUrl(iconUrl);
    const destination = options.destination || 'image';
    const accept = options.accept || 'image/avif,image/webp,image/apng,image/*,*/*;q=0.5';

    for (let redirectCount = 0; redirectCount <= MAX_ICON_REDIRECTS; redirectCount++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(safeUrl, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': accept,
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Referer': `${safeUrl.origin}/`,
                    'Sec-Fetch-Dest': destination,
                    'Sec-Fetch-Mode': destination === 'document' ? 'navigate' : 'no-cors',
                    'Sec-Fetch-Site': destination === 'document' ? 'none' : 'same-origin',
                    ...(destination === 'document' ? { 'Upgrade-Insecure-Requests': '1' } : {})
                }
            });
            clearTimeout(timeoutId);

            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('location');
                if (!location) {
                    throw new Error(`Redirect without location from ${safeUrl.href}`);
                }

                safeUrl = await assertPublicHttpUrl(new URL(location, safeUrl).toString());
                continue;
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    throw new Error(`Too many redirects from ${iconUrl}`);
}

function normalizeFaviconInput(input: string) {
    try {
        return new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
        return null;
    }
}

function getIconFormat(buffer: Buffer) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { extension: 'png', contentType: 'image/png' };
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { extension: 'jpg', contentType: 'image/jpeg' };
    }
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
        return { extension: 'gif', contentType: 'image/gif' };
    }
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return { extension: 'webp', contentType: 'image/webp' };
    }
    if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp' && /^(avif|avis)$/.test(buffer.subarray(8, 12).toString('ascii'))) {
        return { extension: 'avif', contentType: 'image/avif' };
    }
    if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') {
        return { extension: 'bmp', contentType: 'image/bmp' };
    }
    if (buffer.length >= 4 && buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) {
        return { extension: 'ico', contentType: 'image/x-icon' };
    }
    const svg = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[^]*?-->\s*)*<svg\b[^>]*>/i.test(svg)
        && /<\/svg\s*>\s*$|<svg\b[^>]*\/\s*>\s*$/i.test(svg)) {
        return { extension: 'svg', contentType: 'image/svg+xml' };
    }
    return null;
}

export function getTraditionalFaviconCandidates(input: string) {
    const parsedUrl = normalizeFaviconInput(input);
    const domain = parsedUrl?.hostname || '';
    if (!domain) return [];

    return Array.from(new Set([
        `${parsedUrl?.origin || `https://${domain}`}/favicon.ico`,
        `${parsedUrl?.origin || `https://${domain}`}/favicon.png`,
        `${parsedUrl?.origin || `https://${domain}`}/apple-touch-icon.png`,
        `${parsedUrl?.origin || `https://${domain}`}/favicon-32x32.png`,
        `${parsedUrl?.origin || `https://${domain}`}/favicon-16x16.png`,
    ]));
}

export function getFaviconProviderCandidates(input: string) {
    const parsedUrl = normalizeFaviconInput(input);
    const domain = parsedUrl?.hostname || '';
    if (!domain) return [];
    return FAVICON_PROVIDERS.map(provider => provider(domain));
}

export function getFaviconCandidates(input: string) {
    return Array.from(new Set([
        ...getTraditionalFaviconCandidates(input),
        ...getFaviconProviderCandidates(input),
    ]));
}

function parseTagAttributes(tag: string) {
    const attributes: Record<string, string> = {};
    const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let match: RegExpExecArray | null;

    while ((match = attributePattern.exec(tag))) {
        attributes[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }

    return attributes;
}

function extractDeclaredFaviconUrls(html: string, pageUrl: URL) {
    const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
    const baseHref = baseTag ? parseTagAttributes(baseTag).href : '';
    let baseUrl = pageUrl;

    if (baseHref) {
        try {
            baseUrl = new URL(baseHref, pageUrl);
        } catch { }
    }

    const candidates: Array<{ url: string; score: number }> = [];
    const linkTags = html.match(/<link\b[^>]*>/gi) || [];

    for (const tag of linkTags) {
        const attributes = parseTagAttributes(tag);
        const rel = (attributes.rel || '').toLowerCase().split(/\s+/);
        let href = attributes.href?.trim();
        if (!href || (!rel.includes('icon') && !rel.includes('apple-touch-icon') && !rel.includes('mask-icon'))) continue;

        const markdownLink = href.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
        if (markdownLink) href = markdownLink[1];
        if (/^(data|javascript):/i.test(href)) continue;

        try {
            const size = Math.max(...(attributes.sizes || '').match(/\d+/g)?.map(Number) || [0]);
            const relScore = rel.includes('icon') ? 0 : rel.includes('apple-touch-icon') ? 1000 : 2000;
            const scalableSize = attributes.sizes === 'any' ? 512 : size;
            candidates.push({ url: new URL(href, baseUrl).toString(), score: relScore - scalableSize });
        } catch { }
    }

    return candidates.sort((a, b) => a.score - b.score).map(candidate => candidate.url);
}

export async function discoverDeclaredFaviconCandidates(input: string) {
    const pageUrl = normalizeFaviconInput(input);
    if (!pageUrl) return [];

    let declaredCandidates: string[] = [];
    try {
        const response = await fetchIcon(pageUrl.toString(), {
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
            destination: 'document'
        });
        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || 0);

        if (response.ok && (!contentType || /text\/html|application\/xhtml\+xml/i.test(contentType)) && contentLength <= MAX_HTML_BYTES) {
            const htmlBuffer = Buffer.from(await response.arrayBuffer());
            if (htmlBuffer.length <= MAX_HTML_BYTES) {
                const finalPageUrl = response.url ? new URL(response.url) : pageUrl;
                const html = htmlBuffer.toString('utf8');
                declaredCandidates = extractDeclaredFaviconUrls(html, finalPageUrl);
                // These panels replace the tab favicon with their configured logo at runtime.
                // Do not probe arbitrary sites or treat unrelated status JSON as branding.
                if (/<title[^>]*>\s*(?:New API|One API|Veloera)\s*<\/title>/i.test(html)) {
                    try {
                        const statusUrl = new URL('/api/status', finalPageUrl);
                        const status = await fetchIcon(statusUrl.href, { accept: 'application/json', destination: 'document' });
                        if (status.ok && /application\/json/i.test(status.headers.get('content-type') || '')
                            && Number(status.headers.get('content-length') || 0) <= MAX_HTML_BYTES) {
                            const body = Buffer.from(await status.arrayBuffer());
                            if (body.length <= MAX_HTML_BYTES) {
                                const config = JSON.parse(body.toString('utf8'));
                                const data = config?.data;
                                if (config?.success === true && typeof data?.system_name === 'string'
                                    && typeof data?.version === 'string' && typeof data?.logo === 'string' && data.logo.trim()) {
                                    const logo = new URL(data.logo.trim(), statusUrl);
                                    if (['http:', 'https:'].includes(logo.protocol)) declaredCandidates.unshift(logo.href);
                                }
                            }
                        }
                    } catch {
                        // Static favicon discovery must still work if the status endpoint fails.
                    }
                }
            }
        }
    } catch (error) {
        console.warn(`[Icon Downloader] Failed to inspect page ${pageUrl}:`, error);
    }

    return Array.from(new Set(declaredCandidates));
}

export function getCachedIconPath(siteId: string) {
    for (const extension of ICON_EXTENSIONS) {
        const filePath = path.join(CACHED_ICONS_DIR, `site-${siteId}.${extension}`);
        if (fs.existsSync(filePath)) return filePath;
    }
    return null;
}

export async function downloadAndSaveIcon(
    siteId: string,
    iconUrl: string | string[],
    options: { force?: boolean; storage?: 'cache' | 'upload'; siteUrl?: string } = {}
): Promise<string | null> {
    const iconUrls = Array.from(new Set(Array.isArray(iconUrl) ? iconUrl : [iconUrl])).filter(Boolean);
    const storage = options.storage || 'cache';

    if (storage === 'cache') {
        const cachedIcon = getCachedIconPath(siteId);
        if (cachedIcon && !options.force) {
            return `/api/sites/${encodeURIComponent(siteId)}/icon`;
        }

        const pendingDownload = iconDownloads.get(siteId);
        if (pendingDownload) return pendingDownload;
    }

    const downloadPromise = (async () => {
    try {
        console.log(`[Icon Downloader] Starting download for site ${siteId} from ${iconUrls.join(', ')}`);

        const targetDirectory = storage === 'cache' ? CACHED_ICONS_DIR : UPLOADED_ICONS_DIR;
        if (!fs.existsSync(targetDirectory)) {
            await mkdir(targetDirectory, { recursive: true });
        }

        // A page's declared icon is authoritative; guessed /favicon.ico may be a stale template.
        // Keep an explicitly supplied upload URL ahead of automatic discovery.
        if (storage === 'cache' && options.siteUrl) {
            const declared = await discoverDeclaredFaviconCandidates(options.siteUrl);
            const candidates = Array.from(new Set([...declared, ...iconUrls]));
            iconUrls.splice(0, iconUrls.length, ...candidates);
        }

        const attemptedUrls = new Set<string>();
        let fallbackPhase = 0;

        while (true) {
            const candidateUrl = iconUrls.find(url => !attemptedUrls.has(url));
            if (!candidateUrl) {
                if (!options.siteUrl || fallbackPhase >= 2) break;

                const fallbackUrls = fallbackPhase === 0
                    ? (storage === 'cache' ? [] : await discoverDeclaredFaviconCandidates(options.siteUrl))
                    : getFaviconProviderCandidates(options.siteUrl);
                fallbackPhase += 1;

                for (const fallbackUrl of fallbackUrls) {
                    if (!iconUrls.includes(fallbackUrl)) iconUrls.push(fallbackUrl);
                }
                continue;
            }

            attemptedUrls.add(candidateUrl);
            const response = await fetchIcon(candidateUrl).catch((error) => {
                console.error(`[Icon Downloader] Failed candidate ${candidateUrl}:`, error);
                return null;
            });

            if (!response) continue;

            if (!response.ok) {
                console.error(`[Icon Downloader] Failed to fetch icon ${candidateUrl}: ${response.status} ${response.statusText}`);
                continue;
            }

            const contentLength = Number(response.headers.get('content-length') || 0);
            if (contentLength > MAX_ICON_BYTES) {
                console.error('[Icon Downloader] Icon too large');
                continue;
            }

            const iconBuffer = Buffer.from(await response.arrayBuffer());
            if (!iconBuffer.length || iconBuffer.length > MAX_ICON_BYTES) {
                console.error('[Icon Downloader] Icon body is empty or too large');
                continue;
            }

            const iconFormat = getIconFormat(iconBuffer);
            if (!iconFormat) {
                console.error(`[Icon Downloader] Unsupported icon format from ${candidateUrl}`);
                continue;
            }

            const filename = `site-${siteId}.${iconFormat.extension}`;
            const filepath = path.join(targetDirectory, filename);
            const temporaryPath = `${filepath}.tmp`;
            try {
                await fs.promises.writeFile(temporaryPath, iconBuffer);
                if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                await fs.promises.rename(temporaryPath, filepath);
            } finally {
                if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
            }

            for (const extension of ICON_EXTENSIONS) {
                const oldPath = path.join(targetDirectory, `site-${siteId}.${extension}`);
                if (oldPath !== filepath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            console.log(`[Icon Downloader] Icon saved to ${filepath}`);

            const publicUrl = storage === 'cache'
                ? `/api/sites/${encodeURIComponent(siteId)}/icon?v=${Date.now()}`
                : `/uploads/icons/${filename}?v=${Date.now()}`;

            // 5. Update DB
            await prisma.site.update({
                where: { id: siteId },
                data: storage === 'cache'
                    ? { icon: publicUrl }
                    : { icon: publicUrl, iconType: 'upload', customIconUrl: publicUrl }
            });

            return publicUrl;
        }

        return null;
    } catch (error) {
        console.error('[Icon Downloader] Error:', error);
        return null;
    }
    })();

    if (storage === 'cache') iconDownloads.set(siteId, downloadPromise);

    try {
        return await downloadPromise;
    } finally {
        if (storage === 'cache' && iconDownloads.get(siteId) === downloadPromise) {
            iconDownloads.delete(siteId);
        }
    }
}

export function deleteCachedIcon(siteId: string) {
    for (const extension of ICON_EXTENSIONS) {
        const filePath = path.join(CACHED_ICONS_DIR, `site-${siteId}.${extension}`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
}

export async function deleteIcon(customIconUrl: string) {
    if (!customIconUrl || !customIconUrl.startsWith('/uploads/')) return;

    try {
        // Remove query parameters if present
        const urlWithoutQuery = customIconUrl.split('?')[0];
        const filename = urlWithoutQuery.split('/').pop();
        if (!filename) return;

        const filepath = path.join(UPLOADED_ICONS_DIR, filename);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`Deleted local icon: ${filepath}`);
        }
    } catch (error) {
        console.error('Error deleting icon:', error);
    }
}

export async function saveBase64Icon(siteId: string, base64String: string) {
    try {
        // Extract content type and data
        const matches = base64String.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
        if (!matches || matches.length !== 3) {
            return null;
        }

        const buffer = Buffer.from(matches[2], 'base64');
        if (!buffer.length || buffer.length > MAX_ICON_BYTES) return null;
        const format = getIconFormat(buffer);
        if (!format) return null;
        const ext = format.extension;

        const filename = `site-${siteId}.${ext}`;
        const filepath = path.join(UPLOADED_ICONS_DIR, filename);
        // Add timestamp as query param for cache busting
        const publicPath = `/uploads/icons/${filename}?v=${Date.now()}`;

        fs.writeFileSync(filepath, buffer);
        console.log(`Base64 icon saved for site ${siteId}: ${publicPath}`);

        return publicPath;
    } catch (error) {
        console.error(`Error saving base64 icon for site ${siteId}:`, error);
        return null;
    }
}
