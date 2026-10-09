import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'favicon-test-'));
const source = fs.readFileSync(new URL('../lib/icon-downloader.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
let routes = new Map();
let requests = [];
let updates = [];
const context = {
    exports: {}, Buffer, URL, AbortController, setTimeout, clearTimeout,
    process: { cwd: () => root },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
        if (name === './prisma') return { prisma: { site: { update: async (args) => { updates.push(args); } } } };
        if (name === './safe-url') return { assertPublicHttpUrl: async (input) => new URL(input) };
        return require(name);
    },
    fetch: async (url) => {
        requests.push(String(url));
        const result = routes.get(String(url));
        if (!result) return new Response('missing', { status: 404 });
        return new Response(result.body, { headers: { 'content-type': result.type } });
    }
};
vm.runInNewContext(compiled, context);
const api = context.exports;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle r="8"/></svg>';
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function setup(entries) { routes = new Map(entries); requests = []; updates = []; }
try {
    // A declared icon already present in the guessed candidates must still move to the front.
    setup([
        ['https://example.com/', { type: 'text/html', body: '<link rel="icon" href="/favicon.png">' }],
        ['https://example.com/favicon.png', { type: 'image/png', body: png }],
        ['https://example.com/favicon.ico', { type: 'image/png', body: png }]
    ]);
    assert.ok(await api.downloadAndSaveIcon('declared', api.getTraditionalFaviconCandidates('https://example.com/'), { siteUrl: 'https://example.com/' }));
    assert.equal(requests[1], 'https://example.com/favicon.png');
    assert.equal(updates.length, 1);

    setup([
        ['https://panel.example/', { type: 'text/html', body: '<title>New API</title><link rel="icon" href="/favicon.ico">' }],
        ['https://panel.example/api/status', { type: 'application/json', body: JSON.stringify({ success: true, data: { logo: 'https://images.example/custom.svg', system_name: 'Custom', version: '1' } }) }],
        ['https://images.example/custom.svg', { type: 'image/svg+xml', body: svg }]
    ]);
    assert.ok(await api.downloadAndSaveIcon('dynamic', api.getTraditionalFaviconCandidates('https://panel.example/'), { siteUrl: 'https://panel.example/' }));
    assert.equal(requests[2], 'https://images.example/custom.svg');
    assert.ok(api.getCachedIconPath('dynamic').endsWith('.svg'));
    assert.equal(fs.readFileSync(api.getCachedIconPath('dynamic'), 'utf8'), svg);

    setup([
        ['https://panel.example/', { type: 'text/html', body: '<title>New API</title><link rel="icon" href="/favicon.ico">' }],
        ['https://panel.example/favicon.ico', { type: 'image/png', body: png }]
    ]);
    assert.ok(await api.downloadAndSaveIcon('fallback', api.getTraditionalFaviconCandidates('https://panel.example/'), { siteUrl: 'https://panel.example/' }));
    assert.equal(requests.at(-1), 'https://panel.example/favicon.ico');

    setup([
        ['https://normal.example/', { type: 'text/html', body: '<title>Normal</title><link rel="icon" href="/icon.svg" sizes="any">' }]
    ]);
    assert.deepEqual(Array.from(await api.discoverDeclaredFaviconCandidates('https://normal.example/')), ['https://normal.example/icon.svg']);
    assert.equal(requests.length, 1); // No status probe for ordinary websites.

    setup([['https://images.example/manual.png', { type: 'image/png', body: png }]]);
    assert.ok(await api.downloadAndSaveIcon('manual', 'https://images.example/manual.png', { storage: 'upload', siteUrl: 'https://normal.example/' }));
    assert.deepEqual(requests, ['https://images.example/manual.png']);

    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const first = await api.saveBase64Icon('upload-a', dataUrl);
    const second = await api.saveBase64Icon('upload-b', dataUrl);
    assert.ok(first.includes('site-upload-a.svg?'));
    assert.ok(second.includes('site-upload-b.svg?'));
    assert.notEqual(first, second);
    assert.equal(await api.saveBase64Icon('bad', `data:image/png;base64,${Buffer.from('<html>not an image</html>').toString('base64')}`), null);
    assert.equal(await api.saveBase64Icon('large', `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}`), null);
    api.deleteCachedIcon('dynamic');
    assert.equal(api.getCachedIconPath('dynamic'), null);
    console.log('PASS: favicon priority, runtime logo, SVG, fallback, manual URL, upload isolation, invalid/oversize rejection, cache deletion');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
