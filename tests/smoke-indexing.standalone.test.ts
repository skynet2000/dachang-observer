// A 200 response alone cannot detect accidental noindex or contradictory sitemap entries.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { after, test } from 'node:test';
import { SITE } from '@aihot/site';

let mode = 'ok';
let origin: string;
const privatePages = new Set(['/starred', '/feedback', '/more', '/admin/login', '/workplace-leads']);
const server = createServer((req, res) => {
  const path = new URL(req.url!, 'http://fixture').pathname;
  if (path === '/api/mcp') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ serverInfo: { name: SITE.mcpPrefix } }));
  }
  if (path.startsWith('/api/') || path.endsWith('.json')) {
    res.setHeader('content-type', 'application/json'); return res.end('{}');
  }
  if (path === '/sitemap.xml') {
    const loc = ({ alias: '/', 'private-sitemap': '/more', redirect: '/moved', missing: '/missing' } as Record<string, string>)[mode] ?? '/all';
    res.setHeader('content-type', 'application/xml');
    return res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${mode === 'empty' ? '' : `<url><loc>${origin}${loc}</loc></url>`}</urlset>`);
  }
  if (path.endsWith('.xml')) { res.setHeader('content-type', 'application/xml'); return res.end('<rss/>'); }
  if (path.endsWith('.txt')) { res.setHeader('content-type', 'text/plain'); return res.end('User-agent: *\nAllow: /'); }
  if (path.endsWith('.webmanifest')) { res.setHeader('content-type', 'application/manifest+json'); return res.end('{}'); }
  if (path.endsWith('.png') || path.endsWith('.ico')) { res.setHeader('content-type', path.endsWith('.png') ? 'image/png' : 'image/x-icon'); return res.end(); }
  if (path === '/moved') { res.writeHead(301, { location: '/all' }); return res.end(); }
  if (path === '/missing') res.statusCode = 404;
  if (mode === 'header' && path === '/all') res.setHeader('X-Robots-Tag', 'noindex, follow');
  const excluded = privatePages.has(path) && !(mode === 'private' && path === '/more');
  const robots = excluded || mode === 'meta' && path === '/all' ? '<meta content="NOINDEX, follow" name="ROBOTS">' : '';
  const canonical = path === '/' ? '/all' : path;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<html><head>${robots}<link rel="canonical" href="${origin}${canonical}"></head><body>${SITE.name}</body></html>`);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => new Promise<void>(resolve => server.close(() => resolve())));

function smoke() {
  return new Promise<{ code: number; stdout: string }>(resolve => {
    execFile(process.execPath, ['scripts/smoke.ts', '--base', origin], { timeout: 20_000 }, (error, stdout) => {
      resolve({ code: error ? typeof error.code === 'number' ? error.code : 1 : 0, stdout });
    });
  });
}

test('smoke allows intentional noindex on private pages and a canonical news sitemap', async () => {
  mode = 'ok';
  const result = await smoke();
  assert.equal(result.code, 0, result.stdout);
});

for (const [fault, message] of [
  ['meta', /noindex/], ['header', /noindex/], ['private', /missing noindex/],
  ['alias', /canonical/], ['private-sitemap', /noindex/],
  ['redirect', /HTTP 301/], ['missing', /HTTP 404/], ['empty', /sitemap has no URLs/],
] as const) {
  test(`smoke rejects the ${fault} indexing regression`, async () => {
    mode = fault;
    const result = await smoke();
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, message);
  });
}
