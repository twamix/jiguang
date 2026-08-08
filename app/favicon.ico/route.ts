import { NextResponse } from 'next/server';
import { getSiteFavicon } from '@/lib/site-favicon';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
    const favicon = await getSiteFavicon();

    return new NextResponse(new Uint8Array(favicon.body), {
        headers: {
            'Content-Type': favicon.contentType,
            'Content-Length': favicon.body.length.toString(),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
    });
}
