import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { EDITORIAL } from "@aihot/site";
import { siteLd } from "../app/lib/seo.ts";
import { startWebServer, type WebServer } from "./web-server.ts";

const api = createServer((req, res) => {
  const url = new URL(req.url!, "http://fixture");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/api/site/meta") return res.end('{"changelogVersion":null}');
  if (url.pathname === "/api/site/pool") return res.end(JSON.stringify({
    filters: { channel: "all", category: url.searchParams.get("category"), tag: url.searchParams.get("tag"), q: url.searchParams.get("q"), tab: "time" },
    items: [], page: Number(url.searchParams.get("page") ?? 1), pageCount: 3, total: 0, todayCount: 0, freshness: null,
  }));
  res.statusCode = 404; res.end("{}");
});
let web: WebServer;
before(async () => { web = await startWebServer(api); });
after(async () => { await web?.stop(); });
const jsonLd = (html: string): Array<Record<string, unknown>> => [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .flatMap(match => { const value = JSON.parse(match[1]!); return Array.isArray(value) ? value : [value]; });

test("Dataset licensing uses the site's existing terms in both selection modes", () => {
  const previous = EDITORIAL.selectionEnabled, previousUrl = process.env.SITE_URL;
  process.env.SITE_URL = "https://fixture.example";
  try {
    for (const enabled of [false, true]) {
      EDITORIAL.selectionEnabled = enabled;
      const dataset = siteLd().find(value => value["@type"] === "Dataset") as Record<string, unknown>;
      assert.equal(dataset.license, "https://fixture.example/terms");
      assert.equal(dataset.url, `https://fixture.example${enabled ? "" : "/all"}`);
      assert.equal(dataset.isAccessibleForFree, true);
      const downloads = dataset.distribution as Array<{ name: string; contentUrl: string }>;
      assert.ok(downloads.some(d => d.contentUrl === `https://fixture.example/api/v1/items${enabled ? "" : "?mode=all"}`));
      assert.ok(downloads.some(d => d.contentUrl === "https://fixture.example/feed.xml"), "historical selection feed keeps its address");
      if (!enabled) assert.doesNotMatch(String(dataset.description), /每日精选|评分/);
    }
  } finally {
    EDITORIAL.selectionEnabled = previous;
    if (previousUrl === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousUrl;
  }
});

test("the rendered canonical news homepage publishes one licensed Dataset and an accessible terms page", async () => {
  for (const path of ["/", "/all"]) {
    const response = await fetch(web.origin + path);
    assert.equal(response.status, 200);
    const html = await response.text(), data = jsonLd(html);
    assert.equal(data.filter(value => value["@type"] === "Dataset").length, 1);
    assert.equal(data.find(value => value["@type"] === "Dataset")!.license, web.origin + "/terms");
    assert.equal(data.find(value => value["@type"] === "Dataset")!.url, web.origin + "/all");
    assert.ok(data.some(value => value["@type"] === "WebSite"));
    assert.ok(data.some(value => value["@type"] === "ItemList"));
    assert.ok(html.includes(`href="${web.origin}/all"`));
  }
  const terms = await fetch(web.origin + "/terms");
  assert.equal(terms.status, 200);
  assert.match(await terms.text(), /原文版权归原作者和来源方所有/);
});

test("filtered searches and archive pages do not duplicate the homepage Dataset", async () => {
  for (const path of ["/all?category=jobs", "/all?q=fixture", "/all?page=2"]) {
    const response = await fetch(web.origin + path);
    assert.equal(response.status, 200);
    assert.equal(jsonLd(await response.text()).filter(value => value["@type"] === "Dataset").length, 0);
  }
});

test("paused selection permanently redirects the duplicate home to the canonical news feed with parameters intact", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const query of ["", "?category=jobs&page=2", "?q=fixture&utm_source=test"]) {
      const response = await fetch(web.origin + "/" + query, { method, redirect: "manual" });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("location"), "/all" + query);
      if (method === "HEAD") assert.equal(await response.text(), "");
    }
  }
  const response = await fetch(web.origin + "/all", { redirect: "manual" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
  assert.match(html, new RegExp(`rel="canonical" href="${web.origin}/all"`));
});
