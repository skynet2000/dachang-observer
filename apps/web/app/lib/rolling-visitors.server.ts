import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const BITMAP_BYTES = 32 * 1024;
const BITS = BITMAP_BYTES * 8;
const BITMAP_NAME = /^\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.bits$/;

type Key = { secret: string; since: string };

async function readIfPresent(file: string) {
  try { return await readFile(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

async function readKey(dir: string): Promise<Key | null> {
  const raw = await readIfPresent(path.join(dir, "key.state"));
  if (!raw) return null;
  const key = JSON.parse(raw.toString()) as Key;
  if (!/^[a-f0-9]{64}$/.test(key.secret) || !Number.isFinite(Date.parse(key.since))) throw new Error("Invalid rolling visitor state");
  return key;
}

async function save(file: string, content: Buffer | string) {
  const temp = `${file}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}

function oldestDay(now: Date) {
  return beijingDate(+now - (WINDOW_DAYS - 1) * DAY_MS);
}

function bitmapName(day: string, key: Key) {
  // A replacement key must never mix with pre-existing bitmaps from a different generation.
  const generation = createHash("sha256").update(key.secret).digest("hex").slice(0, 16);
  return `${day}-${generation}.bits`;
}

async function readBitmap(file: string) {
  const data = await readIfPresent(file);
  if (data && data.length !== BITMAP_BYTES) throw new Error("Invalid rolling visitor bitmap");
  return data;
}

/** Called by the existing single web process, inside the access statistics queue. */
export class RollingVisitors {
  private readonly dir: string;
  private current: { day: string; key: Key; file: string; bits: Buffer } | null = null;

  constructor(trafficDir: string) { this.dir = path.join(trafficDir, "mau"); }

  async record(identity: string, at: Date) {
    const day = beijingDate(at);
    if (this.current?.day !== day) {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      let key = await readKey(this.dir);
      if (!key) {
        key = { secret: randomBytes(32).toString("hex"), since: at.toISOString() };
        await save(path.join(this.dir, "key.state"), JSON.stringify(key));
      }
      const file = path.join(this.dir, bitmapName(day, key));
      const bits = await readBitmap(file) ?? Buffer.alloc(BITMAP_BYTES);
      const oldest = oldestDay(at);
      for (const name of await readdir(this.dir)) {
        if (BITMAP_NAME.test(name) && name.slice(0, 10) < oldest) await unlink(path.join(this.dir, name));
      }
      this.current = { day, key, file, bits };
    }

    const { key, file, bits } = this.current;
    const bit = createHmac("sha256", Buffer.from(key.secret, "hex")).update(identity).digest().readUInt32BE(0) % BITS;
    const index = bit >> 3;
    const previous = bits[index]!;
    const next = previous | 1 << (bit & 7);
    if (previous === next) return;
    bits[index] = next;
    try { await save(file, bits); }
    catch (error) { bits[index] = previous; throw error; }
  }
}

/** Estimate the union with linear counting. Only totals and coverage leave the private directory. */
export async function readRollingVisitors(trafficDir: string, now = new Date()) {
  const dir = path.join(trafficDir, "mau");
  const key = await readKey(dir);
  if (!key || Date.parse(key.since) > +now) return null;

  const oldest = oldestDay(now);
  const from = new Date(Math.max(Date.parse(key.since), +beijingMidnight(oldest))).toISOString();
  const combined = Buffer.alloc(BITMAP_BYTES);
  let days = 0;
  for (let ago = 0; ago < WINDOW_DAYS; ago++) {
    const day = beijingDate(+now - ago * DAY_MS);
    if (day < beijingDate(key.since)) break;
    const bits = await readBitmap(path.join(dir, bitmapName(day, key)));
    if (!bits) continue;
    days++;
    for (let index = 0; index < combined.length; index++) combined[index] = combined[index]! | bits[index]!;
  }
  if (!days) return null;

  let occupied = 0;
  for (let byte of combined) for (; byte; byte &= byte - 1) occupied++;
  const estimate = occupied === BITS ? null : Math.round(-BITS * Math.log1p(-occupied / BITS));
  return { estimate, days, from, complete: days === WINDOW_DAYS && Date.parse(key.since) <= +beijingMidnight(oldest) };
}
