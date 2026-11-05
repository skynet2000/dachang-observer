import { load } from "cheerio";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { parseLooseDate } from "@aihot/backend/sources/dates";
import { FetchError, type Candidate } from "@aihot/backend/sources/types";

const BASE = "https://maimai.cn";
const USER_AGENT = "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36";

function headers(cookie: string): Record<string, string> {
  return { cookie, accept: "text/html", "user-agent": USER_AGENT };
}

function jsonArrayAt(text: string, start: number): unknown[] | null {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) {
        try { const value = JSON.parse(text.slice(start, i + 1)); return Array.isArray(value) ? value : null; }
        catch { return null; }
      }
    }
  }
  return null;
}

/** Only accept the official hot-topic array, never the personalized feed or company-circle posts. */
export function parseHotRank(html: string): Candidate[] {
  const $ = load(html);
  let flight = "";
  for (const script of $("script").toArray()) {
    const body = $(script).html() ?? "", prefix = "self.__next_f.push(";
    if (!body.startsWith(prefix) || !body.endsWith(")")) continue;
    try {
      const payload = JSON.parse(body.slice(prefix.length, -1));
      if (typeof payload[1] === "string") flight += payload[1];
    } catch { /* Other scripts are not Flight payloads. */ }
  }
  const marker = '"data":[';
  for (let from = 0, index = flight.indexOf(marker); index >= 0; index = flight.indexOf(marker, from)) {
    from = index + marker.length;
    const rows = jsonArrayAt(flight, index + marker.length - 1);
    if (!rows || rows.length < 3) continue;
    const topics = rows.filter((value): value is { id: string; name: string; type: number; schema: string } => {
      if (!value || typeof value !== "object") return false;
      const row = value as Record<string, unknown>;
      return typeof row.id === "string" && /^[\w-]{1,40}$/.test(row.id)
        && typeof row.name === "string" && row.type === 9 && typeof row.schema === "string"
        && row.schema.includes("component=GossipGlobalTopicList") && row.schema.includes(`topic_id=${row.id}&`);
    });
    if (topics.length >= 3 && topics.length === rows.length) {
      return topics.slice(0, 15).map(topic => ({
        url: `${BASE}/n/content/global-topic?circle_type=9&topic_id=${topic.id}`, title: topic.name,
      }));
    }
  }
  throw new FetchError("Authenticated Maimai hot-topic list not found");
}

export async function fetchAuthenticatedHotRank(cookie: string): Promise<Candidate[]> {
  const res = await fetchListing(`${BASE}/community/hot-rank`, { redirectPolicy: "same-origin", headers: headers(cookie) });
  if (res.status !== 200 || new URL(res.url).pathname.includes("/login")) throw new FetchError("Maimai session expired or hot rank unavailable");
  return parseHotRank(res.text());
}

/** A search result can supply a timestamp only when its post ID exactly matches. */
export function searchPostTimes(data: unknown): Map<string, Date> {
  const times = new Map<string, Date>();
  if (!data || typeof data !== "object") return times;
  const response = data as { data?: { gossips?: Array<{ gid?: unknown; gossip?: { id?: unknown; crtime?: unknown } }> } };
  if (!Array.isArray(response.data?.gossips)) return times;
  for (const row of response.data.gossips) {
    const id = String(row.gid);
    if (!/^\d+$/.test(id) || String(row.gossip?.id) !== id) continue;
    const time = row.gossip?.crtime;
    if (typeof time !== "string" || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(time)) continue;
    const parsed = parseLooseDate(time, "+08:00");
    if (parsed) times.set(id, parsed);
  }
  return times;
}

export function parseSearchPage(html: string): Map<string, Date> {
  const $ = load(html);
  for (const script of $("script").toArray()) {
    const match = /share_data\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec($(script).html() ?? "");
    if (!match) continue;
    try {
      const data = JSON.parse(JSON.parse(match[1]!));
      if (!Array.isArray(data?.data?.gossips)) break;
      return searchPostTimes(data);
    } catch { break; }
  }
  throw new FetchError("Maimai search returned invalid data");
}

export async function fetchPostTimes(cookie: string, query: string): Promise<Map<string, Date>> {
  const params = new URLSearchParams({ type: "gossip", query, highlight: "true" });
  const res = await fetchListing(`${BASE}/web/search_center?${params}`, { redirectPolicy: "same-origin", headers: headers(cookie) });
  if (res.status !== 200 || new URL(res.url).pathname.includes("/login")) throw new FetchError("Maimai session expired or search unavailable");
  return parseSearchPage(res.text());
}
