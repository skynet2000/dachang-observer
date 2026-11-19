// Daily request totals and estimated visitors; raw addresses, headers and cookies never reach disk.
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile, readdir, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { RollingVisitors } from "./rolling-visitors.server.ts";

interface Visit { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; status: number; type: string; clientAddress?: string }
interface Day { day: string; views: number; bots: number; errors: number; notFound: number; pages: Record<string, number>; uniqueVisitors?: number; uvSince?: string }
interface VisitorState { day: string; key: string; since: string; visitors: Set<string> }
const beijingDay = (at: Date) => new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

export class AccessStats {
  private pending: Promise<void> = Promise.resolve();
  private initialized = false;
  private dir: string;
  private now: () => Date;
  private uvSince = "";
  private visitors: VisitorState | null = null;
  private readonly monthly: RollingVisitors | null;
  constructor(dir: string, now = () => new Date(), monthlyEnabled = false) {
    this.dir = dir;
    this.now = now;
    this.monthly = monthlyEnabled ? new RollingVisitors(dir) : null;
  }

  record(visit: Visit): Promise<void> {
    if (visit.method !== "GET" || /prefetch/i.test(String(visit.headers["sec-purpose"] ?? visit.headers.purpose ?? ""))) return Promise.resolve();
    let pathname: string;
    try { pathname = new URL(visit.url ?? "/", "http://local").pathname; } catch { return Promise.resolve(); }
    if (/^\/(?:api|admin|assets)(?:\/|$)/i.test(pathname) || /\.(?:js|css|png|svg|ico|jpg|webp|xml|txt|json|woff2)$/i.test(pathname)) return Promise.resolve();
    const navigation = pathname.endsWith(".data");
    if (!navigation && visit.status < 400 && !visit.type.startsWith("text/html")) return Promise.resolve();
    pathname = pathname.replace(/\.data$/, "") || "/";
    if (pathname === "/_root") pathname = "/";
    const at = this.now();
    const bot = /bot\b|crawler|spider|headless|curl|wget|python|playwright|node\b|undici|uptime|monitor/i.test(String(visit.headers["user-agent"] ?? ""));
    const run = this.pending.then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      if (!this.initialized) {
        const meta = path.join(this.dir, "started.json");
        try { await writeFile(meta, JSON.stringify({ since: at.toISOString() }), { flag: "wx", mode: 0o600 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        const uvMeta = path.join(this.dir, "uv-started.json");
        try { await writeFile(uvMeta, JSON.stringify({ since: at.toISOString() }), { flag: "wx", mode: 0o600 }); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        this.uvSince = JSON.parse(await readFile(uvMeta, "utf8")).since;
        this.initialized = true;
      }
      const day = beijingDay(at), file = path.join(this.dir, `${day}.json`);
      let data: Day;
      try { data = JSON.parse(await readFile(file, "utf8")); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; data = { day, views: 0, bots: 0, errors: 0, notFound: 0, pages: {} }; }
      // Only the current day's private deduplication state survives a restart. The backup's *.json
      // aggregate files deliberately exclude this .state file and its random HMAC key.
      const stateFile = path.join(this.dir, "uv-current.state");
      let changed = false;
      let identity: string | undefined;
      if (this.visitors?.day !== day) {
        let saved: { day: string; key: string; since: string; visitors: string[] } | null = null;
        try { saved = JSON.parse(await readFile(stateFile, "utf8")); }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
        if (saved?.day === day) this.visitors = { ...saved, visitors: new Set(saved.visitors) };
        else {
          // A backup has totals but no visitor keys: start a clearly marked partial UV window,
          // rather than add visitors to an unrecoverable set and claim full-day deduplication.
          const since = data.uniqueVisitors ? at.toISOString() : new Date(Math.max(Date.parse(this.uvSince), Date.parse(`${day}T00:00:00+08:00`))).toISOString();
          this.visitors = { day, key: randomBytes(32).toString("hex"), since, visitors: new Set() };
          changed = true;
        }
      }
      if (bot) data.bots++;
      else if (visit.status === 200) {
        data.views++;
        const key = pathname.length <= 180 && (Object.keys(data.pages).length < 2000 || pathname in data.pages) ? pathname : "/[other]";
        data.pages[key] = (data.pages[key] ?? 0) + 1;
        const address = (visit.clientAddress ?? "").replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1").toLowerCase();
        if (isIP(address)) {
          identity = JSON.stringify([address, String(visit.headers["user-agent"] ?? "")]);
          const visitor = createHmac("sha256", this.visitors.key).update(identity).digest("hex");
          if (!this.visitors.visitors.has(visitor)) { this.visitors.visitors.add(visitor); changed = true; }
        }
      } else if (visit.status >= 500) data.errors++;
      else if (visit.status === 404) data.notFound++;
      if (changed) {
        await writeFile(`${stateFile}.tmp`, JSON.stringify({ ...this.visitors, visitors: [...this.visitors.visitors] }), { mode: 0o600 });
        await rename(`${stateFile}.tmp`, stateFile);
      }
      data.uniqueVisitors = this.visitors.visitors.size;
      data.uvSince = this.visitors.since;
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(data), { mode: 0o600 }); await rename(temp, file);
      const oldest = beijingDay(new Date(at.getTime() - 29 * 86400_000));
      for (const old of await readdir(this.dir)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(old) && old < `${oldest}.json`) await unlink(path.join(this.dir, old));
      if (identity) await this.monthly?.record(identity, at);
    });
    this.pending = run.catch(() => {});
    return run;
  }
  flush() { return this.pending; }
}
