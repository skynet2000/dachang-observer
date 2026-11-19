import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile, unlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { AccessStats } from "../app/lib/access-stats.server.ts";
import { RollingVisitors, readRollingVisitors } from "../app/lib/rolling-visitors.server.ts";
import { startWebServer } from "./web-server.ts";

test("anonymous traffic counts Shanghai days, navigation and errors without storing identity or query strings", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "traffic-test-"));
  try {
    const stats = new AccessStats(dir, () => new Date("2026-10-25T15:59:00Z"));
    const page = { method: "GET", url: "/all?token=secret&q=private", headers: { "user-agent": "Mozilla/5.0" }, status: 200, type: "text/html" };
    await stats.record(page);
    await stats.record({ ...page, url: "/daily/2026-10-25.data", type: "text/plain" });
    await stats.record({ ...page, headers: { "user-agent": "Googlebot" } });
    await stats.record({ ...page, headers: { "user-agent": "node" } });
    await stats.record({ ...page, headers: { purpose: "prefetch" } });
    await stats.record({ ...page, url: "/api/reader/session" });
    await stats.record({ ...page, url: "/admin/login" });
    await stats.record({ ...page, url: "/assets/app.js", type: "text/javascript" });
    await stats.record({ ...page, status: 503, type: "text/plain" });
    await stats.record({ ...page, status: 404, type: "", url: "/unknown-private-path" });
    const raw = await readFile(path.join(dir, "2026-10-25.json"), "utf8");
    const day = JSON.parse(raw);
    assert.equal(day.views, 2); assert.equal(day.bots, 2); assert.equal(day.errors, 1); assert.equal(day.notFound, 1);
    assert.deepEqual(day.pages, { "/all": 1, "/daily/2026-10-25": 1 });
    assert.ok(!/secret|private|Mozilla|Googlebot|token|user-agent/i.test(raw));
    const restarted = new AccessStats(dir, () => new Date("2026-10-25T16:01:00Z"));
    await restarted.record(page);
    assert.equal(JSON.parse(await readFile(path.join(dir, "2026-10-26.json"), "utf8")).views, 1);
    assert.equal(JSON.parse(await readFile(path.join(dir, "2026-10-25.json"), "utf8")).views, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("daily estimated UV deduplicates concurrent views and survives restarts without saving raw identifiers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "traffic-uv-"));
  const visit = { method: "GET", url: "/all?secret=private-search", headers: { "user-agent": "Example browser", cookie: "reader=private-account" }, clientAddress: "203.0.113.7", status: 200, type: "text/html" };
  const read = async () => JSON.parse(await readFile(path.join(dir, "2026-10-25.json"), "utf8"));
  try {
    const now = () => new Date("2026-10-25T10:00:00Z");
    const stats = new AccessStats(dir, now);
    await Promise.all(Array.from({ length: 8 }, () => stats.record(visit)));
    assert.equal((await read()).uniqueVisitors, 1);
    await stats.record({ ...visit, clientAddress: "::ffff:203.0.113.7" });
    await stats.record({ ...visit, clientAddress: "203.0.113.8" });
    await stats.record({ ...visit, headers: { "user-agent": "Different browser" } });
    await stats.record({ ...visit, headers: { "user-agent": "Googlebot" } });
    await stats.record({ ...visit, status: 404 });
    await stats.record({ ...visit, clientAddress: undefined, headers: { "x-forwarded-for": "192.0.2.123", "user-agent": "Forged browser" } });
    const restarted = new AccessStats(dir, now);
    await restarted.record(visit);
    const data = await read();
    assert.equal(data.uniqueVisitors, 3);
    assert.equal(data.views, 13);
    assert.equal(data.uvSince, now().toISOString());
    const state = await readFile(path.join(dir, "uv-current.state"), "utf8");
    assert.ok(!/203\.0\.113|192\.0\.2|Example browser|Different browser|cookie|private-account|private-search/.test(state));
    assert.equal(JSON.parse(state).visitors.length, 3);
    assert.equal((await stat(path.join(dir, "uv-current.state"))).mode & 0o777, 0o600);
    assert.ok(!/visitors|key/.test(await readFile(path.join(dir, "2026-10-25.json"), "utf8")));
    const tomorrow = new AccessStats(dir, () => new Date("2026-10-25T16:00:00Z"));
    await tomorrow.record(visit);
    const next = JSON.parse(await readFile(path.join(dir, "uv-current.state"), "utf8"));
    assert.equal(next.visitors.length, 1);
    assert.notEqual(next.key, JSON.parse(state).key);
    assert.ok(!JSON.parse(state).visitors.includes(next.visitors[0]));
    assert.equal(JSON.parse(await readFile(path.join(dir, "2026-10-26.json"), "utf8")).uniqueVisitors, 1);
    assert.equal((await read()).uniqueVisitors, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("UV upgrades and restores preserve PV totals and label partial UV coverage", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "traffic-uv-upgrade-"));
  const visit = { method: "GET", url: "/all", headers: { "user-agent": "Example browser" }, clientAddress: "203.0.113.7", status: 200, type: "text/html" };
  const dayFile = path.join(dir, "2026-10-25.json");
  try {
    await writeFile(path.join(dir, "started.json"), JSON.stringify({ since: "2026-10-24T00:00:00Z" }));
    await writeFile(dayFile, JSON.stringify({ day: "2026-10-25", views: 40, bots: 2, errors: 0, notFound: 0, pages: { "/all": 40 } }));
    await new AccessStats(dir, () => new Date("2026-10-25T12:00:00Z")).record(visit);
    let data = JSON.parse(await readFile(dayFile, "utf8"));
    assert.equal(data.views, 41); assert.equal(data.uniqueVisitors, 1); assert.equal(data.uvSince, "2026-10-25T12:00:00.000Z");
    await unlink(path.join(dir, "uv-current.state"));
    await new AccessStats(dir, () => new Date("2026-10-25T13:00:00Z")).record(visit);
    data = JSON.parse(await readFile(dayFile, "utf8"));
    assert.equal(data.views, 42); assert.equal(data.uniqueVisitors, 1); assert.equal(data.uvSince, "2026-10-25T13:00:00.000Z");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("web UV uses the existing trusted-address boundary without adding cookies or changing public caches", async () => {
  for (const trusted of [false, true]) {
    const dir = await mkdtemp(path.join(tmpdir(), "traffic-uv-web-"));
    const api = createServer((_req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ changelogVersion: null })); });
    const web = await startWebServer(api, { ACCESS_STATS_DIR: dir, TRUST_PROXY: String(trusted) });
    try {
      for (const address of ["203.0.113.1", "203.0.113.2", "203.0.113.2"]) {
        const response = await fetch(web.origin + "/terms", { headers: { "user-agent": "Example browser", "x-forwarded-for": "192.0.2.9, " + address, cookie: "reader=never-used-for-uv" } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("set-cookie"), null);
        assert.match(response.headers.get("cache-control") ?? "", /^public,/);
        await response.text();
      }
      await web.stop();
      const state = JSON.parse(await readFile(path.join(dir, "uv-current.state"), "utf8"));
      assert.equal(state.visitors.length, trusted ? 2 : 1);
      const data = JSON.parse(await readFile(path.join(dir, `${state.day}.json`), "utf8"));
      assert.equal(data.views, 3); assert.equal(data.uniqueVisitors, trusted ? 2 : 1);
      assert.equal(web.logs(), "");
    } finally {
      await web.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("rolling visitor estimates deduplicate Beijing days and retain daily UV eligibility", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "traffic-mau-"));
  let now = new Date("2026-10-25T15:59:00Z");
  const visit = { method: "GET", url: "/all?q=private-search", headers: { "user-agent": "Example browser", cookie: "reader=private-account" },
    clientAddress: "203.0.113.7", status: 200, type: "text/html" };
  try {
    await new AccessStats(dir, () => now).record(visit);
    assert.equal(await readRollingVisitors(dir, now), null, "default daily UV does not create MAU state");
    const mauDir = path.join(dir, "mau");
    await mkdir(mauDir, { mode: 0o700 });
    await writeFile(path.join(mauDir, "key.state"), JSON.stringify({ secret: "17".repeat(32), since: now.toISOString() }), { mode: 0o600 });

    const stats = new AccessStats(dir, () => now, true);
    await Promise.all([stats.record(visit), stats.record(visit), stats.record({ ...visit, clientAddress: "203.0.113.8" })]);
    now = new Date("2026-10-25T16:01:00Z");
    const afterMidnight = new AccessStats(dir, () => now, true);
    await afterMidnight.record({ ...visit, clientAddress: "::ffff:203.0.113.7" });
    await afterMidnight.record({ ...visit, clientAddress: "203.0.113.9" });
    await afterMidnight.record({ ...visit, headers: { "user-agent": "Googlebot" } });
    await afterMidnight.record({ ...visit, url: "/admin/settings" });
    await afterMidnight.record({ ...visit, status: 404 });
    assert.deepEqual(await readRollingVisitors(dir, now), { estimate: 3, days: 2, from: "2026-10-25T15:59:00.000Z", complete: false });
    for (const day of ["2026-10-25", "2026-10-26"]) {
      assert.equal(JSON.parse(await readFile(path.join(dir, `${day}.json`), "utf8")).uniqueVisitors, 2);
    }
    const files = await readdir(mauDir);
    assert.equal(files.filter(file => file.endsWith(".bits")).length, 2);
    for (const name of files) {
      const file = path.join(mauDir, name);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.doesNotMatch(await readFile(file, "utf8"), /203\.0\.113|Example browser|private-account|private-search/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("MAU prunes day 31 and restarts coverage when the private state is lost", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "traffic-mau-window-"));
  try {
    const start = Date.parse("2026-10-25T16:00:00Z");
    const at = (day: number) => new Date(start + day * 86_400_000);
    const mauDir = path.join(dir, "mau");
    await mkdir(mauDir, { mode: 0o700 });
    const keyFile = path.join(mauDir, "key.state");
    await writeFile(keyFile, JSON.stringify({ secret: "17".repeat(32), since: at(0).toISOString() }), { mode: 0o600 });
    const monthly = new RollingVisitors(dir);
    for (let day = 0; day < 30; day++) await monthly.record(day === 0 ? "visitor A" : "visitor B", at(day));
    assert.deepEqual(await readRollingVisitors(dir, at(29)), { estimate: 2, days: 30, from: at(0).toISOString(), complete: true });
    await monthly.record("visitor B", at(30));
    assert.deepEqual(await readRollingVisitors(dir, at(30)), { estimate: 1, days: 30, from: at(1).toISOString(), complete: true });
    assert.equal((await readdir(mauDir)).some(name => name.startsWith("2026-10-26-")), false);

    await unlink(keyFile);
    assert.equal(await readRollingVisitors(dir, at(30)), null);
    const restarted = new RollingVisitors(dir);
    await restarted.record("visitor C", at(30));
    assert.deepEqual(await readRollingVisitors(dir, at(30)), { estimate: 1, days: 1, from: at(30).toISOString(), complete: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("only authenticated settings readers can see the MAU estimate", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "traffic-mau-admin-"));
  const api = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/api/admin/") && req.headers.cookie !== "admin=allowed") res.writeHead(401);
    if (res.statusCode === 401) return res.end("{}");
    if (req.url === "/api/admin/settings") return res.end(JSON.stringify({ contact: { wechatQr: null, feishuQr: null }, targets: [], budgets: [] }));
    if (req.url === "/api/admin/me") return res.end(JSON.stringify({ name: "Fixture admin" }));
    res.end("{}");
  });
  const web = await startWebServer(api, { ACCESS_STATS_DIR: dir, ACCESS_MAU_ENABLED: "true" });
  try {
    await new RollingVisitors(dir).record("visitor A", new Date());
    const unauthenticated = await fetch(web.origin + "/admin/settings", { redirect: "manual" });
    assert.equal(unauthenticated.status, 302);
    assert.match(unauthenticated.headers.get("location") ?? "", /^\/api\/auth\/login/);
    assert.doesNotMatch(await unauthenticated.text(), /估算月活/);
    const response = await fetch(web.origin + "/admin/settings", { headers: { cookie: "admin=allowed" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = await response.text();
    assert.match(body, /估算月活（MAU）/);
    assert.match(body, /已记录 1 \/ 30 天/);
    assert.doesNotMatch(body, /visitor A|key\.state/);
  } finally { await web.stop(); await rm(dir, { recursive: true, force: true }); }
});
