// Opens the site's main pages and machine exits and checks each answers: the whole-site check after a
// deploy, and CI's check of the built site on an empty database.
//   node scripts/smoke.ts [--base http://localhost:3000]
import { EDITORIAL, SITE } from "@aihot/site";
import { load } from "cheerio";

const at = process.argv.indexOf("--base");
const base = (at > 0 ? process.argv[at + 1] : process.env.SITE_URL) ?? "http://localhost:3000";

const PAGES = ["/", "/all", "/hot", "/daily", "/daily/archive", "/topics", "/starred", "/agent", "/about", "/changelog", "/feedback", "/terms", "/privacy", "/more", "/admin/login", "/workplace-leads"];
const MACHINE: Array<[path: string, type: RegExp]> = [
  ["/api/health", /json/],
  ["/api/v1/items", /json/],
  ["/api/v1/hot-topics", /json/],
  ["/api/v1/selected/snapshot", /json/],
  ["/feed.xml", /xml/],
  ["/feed/all.xml", /xml/],
  ["/llms.txt", /text\/plain/],
  ["/robots.txt", /text\/plain/],
  ["/sitemap.xml", /xml/],
  ["/manifest.webmanifest", /manifest/],
  ["/openapi-v1.json", /json/],
  ["/og/site.png", /image\/png/],
  ["/icon.png", /image\/png/],
  ["/favicon.ico", /icon/],
];

let failed = 0;
let sitemap = "";
const NOINDEX_PAGES = new Set(["/starred", "/feedback", "/more", "/admin/login", "/workplace-leads"]);

function indexingProblem(res: Response, body: string, excluded: boolean): string | null {
  const $ = load(body);
  const directives = [res.headers.get("x-robots-tag") ?? ""];
  $("head meta").each((_, element) => {
    if (["robots", "googlebot"].includes(($(element).attr("name") ?? "").toLowerCase())) directives.push($(element).attr("content") ?? "");
  });
  const noindex = /\b(noindex|none)\b/i.test(directives.join(","));
  return excluded && !noindex ? "private page missing noindex" : !excluded && noindex ? "noindex on an indexable page" : null;
}

async function check(path: string, expect: (res: Response, body: string) => string | null, quiet = false) {
  try {
    const res = await fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const body = res.headers.get("content-type")?.startsWith("image/") ? "" : await res.text();
    const homeAlias = path === "/" && !EDITORIAL.selectionEnabled && !quiet;
    const problem = homeAlias
      ? res.status === 301 && res.headers.get("location") === "/all" ? null : "homepage alias must permanently redirect to /all"
      : res.status !== 200 ? `HTTP ${res.status}` : expect(res, body);
    if (problem || !quiet) console.log(`${problem ? "✗" : "✓"} ${path}${problem ? `  ${problem}` : ""}`);
    if (problem) failed += 1;
  } catch (error) {
    console.log(`✗ ${path}  ${String(error)}`);
    failed += 1;
  }
}

// Pages write the name as HTML text: a name such as "MyF&B" appears as "MyF&amp;B".
const htmlName = SITE.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
for (const path of PAGES) await check(path, (res, body) => {
  if (!body.includes(SITE.name) && !body.includes(htmlName)) return `the page does not name ${SITE.name}`;
  return indexingProblem(res, body, NOINDEX_PAGES.has(path));
});
for (const [path, type] of MACHINE) await check(path, (res, body) => {
  if (path === "/sitemap.xml") sitemap = body;
  return type.test(res.headers.get("content-type") ?? "") ? null : `content-type ${res.headers.get("content-type")}`;
});
// Sitemap entries must be indexable canonical HTML pages, including detail routes absent from PAGES.
const sitemapDocument = load(sitemap, { xml: true });
const urls = sitemapDocument("urlset > url > loc").map((_, element) => sitemapDocument(element).text().trim()).get();
const beforeSitemap = failed;
if (!urls.length) { console.log("✗ sitemap has no URLs"); failed += 1; }
for (let i = 0; i < urls.length; i += 2) {
  await Promise.all(urls.slice(i, i + 2).map(async (loc) => {
    let path: string;
    try { const url = new URL(loc); path = url.pathname + url.search; }
    catch { console.log(`✗ invalid sitemap URL: ${loc}`); failed += 1; return; }
    // Probe the requested deployment, even if SITE_URL advertises its public address.
    await check(path, (res, body) => {
      const problem = indexingProblem(res, body, false);
      if (problem) return problem;
      const page = load(body);
      const canonicals = page("head link[rel=canonical]").map((_, element) => page(element).attr("href")).get();
      return canonicals.length === 1 && canonicals[0] === loc ? null : `canonical does not match sitemap URL ${loc}`;
    }, true);
  }));
}
if (urls.length) console.log(`${failed === beforeSitemap ? "✓" : "✗"} sitemap indexing checked (${urls.length} URLs)`);
// MCP: the handshake answers with the site's server name.
const mcp = await fetch(`${base}/api/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }),
}).then((r) => r.text()).catch((e) => String(e));
const mcpOk = mcp.includes(`"name":"${SITE.mcpPrefix}"`);
console.log(`${mcpOk ? "✓" : "✗"} /api/mcp initialize${mcpOk ? "" : `  ${mcp.slice(0, 200)}`}`);
if (!mcpOk) failed += 1;

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
