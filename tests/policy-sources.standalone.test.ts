// Reduced official list/detail samples verified on 2026-11-14; all requests stay on the local stub.
import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { fetchWebList, fromHtml, fetchDetail } from "@aihot/backend/sources/web-list";
import { admitListing, filterPublicationWindow } from "@aihot/backend/sources/filters";
import { assertSupportedConfig, unsupportedConfig } from "@aihot/backend/sources/config-keys";
import type { SourceRow } from "@aihot/backend/sources/types";

const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
const source = (id: string): SourceRow => ({ cursor: null, fail_count: 0, first_party: true, ...pack.sources.find((s: SourceRow) => s.id === id) });
const appPath = "/jgsj/xgj/APPqhyhqyzxzzxd/tzgg/art/2026/art_14ae49eb4b6c41d6ab08fba27a75553e.html";
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/list") res.end(JSON.stringify({ success: true, data: { html: `<ul><li class="cf"><a href="${appPath}">关于侵害用户权益行为的APP（SDK）通报（2026年第6批）</a><span class="fr">2026-10-15</span></li></ul>` } }));
  else if (req.url === "/detail") res.end('<meta name="PubDate" content="2026-10-15 09:51"><meta name="MakeTime" content="2026-10-22 22:52:58">');
  else if (req.url === "/cac-detail") res.end('<span id="pubtime">2026年11月09日 15:00</span><div style="display:none">publishdate:2026/11/09 15:02:27</div>');
  else if (req.url === "/error") res.end(JSON.stringify({ success: false, message: "unavailable" }));
  else if (req.url === "/empty") res.end(JSON.stringify({ data: { html: "" } }));
  else if (req.url === "/object") res.end(JSON.stringify({ data: { html: {} } }));
  else res.end("not JSON");
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(() => new Promise<void>(resolve => server.close(() => resolve())));

test("official JSON-wrapped HTML lists decode before selectors and keep the publisher URL and list date", async () => {
  const s = source("web-miit-app-rights");
  assertSupportedConfig(s.kind, s.config);
  const items = await fetchWebList({ ...s, config: { ...s.config, url: `${base}/list` } });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.url, `https://www.miit.gov.cn${appPath}`);
  assert.equal(items[0]!.publishedAt?.toISOString(), "2026-10-15T00:00:00.000Z");
  assert.deepEqual(filterPublicationWindow(items, s.config.publishedAfter), [], "an old announcement cannot appear as a new discovery");
});

test("missing or malformed official list payloads fail visibly instead of reporting a healthy empty list", async () => {
  const s = source("web-miit-app-rights");
  for (const path of ["error", "empty", "object", "invalid"]) {
    await assert.rejects(fetchWebList({ ...s, config: { ...s.config, url: `${base}/${path}` } }), /listing (HTML path|response)/);
  }
  for (const value of [false, {}, "", "  "]) assert.ok(unsupportedConfig("web_list", { parseMode: "html", responseHtmlPath: value }).includes("responseHtmlPath"));
  assert.ok(unsupportedConfig("web_list", { parseMode: "markdown", responseHtmlPath: "data.html" }).includes("responseHtmlPath"));
});

test("official detail publication time wins over build time and CAC's CMS write time", async () => {
  const miit = await fetchDetail(`${base}/detail`, source("web-miit-app-rights"), { date: true, title: false, summary: false });
  assert.equal(miit.publishedAt?.toISOString(), "2026-10-15T01:51:00.000Z");
  const cac = await fetchDetail(`${base}/cac-detail`, source("web-cac-releases"), { date: true, title: false, summary: false });
  assert.equal(cac.publishedAt?.toISOString(), "2026-11-09T07:00:00.000Z");
});

test("CAC lists exclude navigation, preserve official cross-links and reject unrelated promotion", () => {
  const s = source("web-cac-data");
  const items = fromHtml('<a href="/wxzw/">导航</a><ul><li><h5><a href="https://www.zjwx.gov.cn/col/col1673564/art/2026/art_b4db8400a4064cf2ba76d47935cd2836.html">浙江省数据出境负面清单管理办法</a></h5><div class="times">2026-11-10</div></li><li><h5><a href="https://untrusted.example/fake">互联网平台监管</a></h5><div class="times">2026-11-14</div></li></ul>', s.config.url, s);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.url, "https://www.zjwx.gov.cn/col/col1673564/art/2026/art_b4db8400a4064cf2ba76d47935cd2836.html");
  assert.deepEqual(admitListing([{ title: "数字乡村大赛颁奖", url: "https://www.cac.gov.cn/test.htm" }, { title: "平台经济合规讲堂开班", url: "https://www.cac.gov.cn/training.htm" }, ...items], s), items);
});

test("SAMR platform scope admits platform rules and named internet companies, not generic antitrust diplomacy", () => {
  const s = source("web-samr-platform-regulation");
  const url = "https://www.samr.gov.cn/xw/zj/art/2026/art_example.html";
  const kept = admitListing([
    { title: "市场监管总局与阿曼签署反垄断合作备忘录", url },
    { title: "市场监管总局发布网络交易平台监管新规", url },
    { title: "腾讯收购事项附条件批准", url },
  ], s);
  assert.deepEqual(kept.map(c => c.title), ["市场监管总局发布网络交易平台监管新规", "腾讯收购事项附条件批准"]);
});
