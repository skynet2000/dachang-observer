import { load } from "cheerio";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { collapseWhitespace, stripTags } from "@aihot/backend/lib/text";
import { getPath } from "@aihot/backend/sources/json-list";
import { parseLooseDate } from "@aihot/backend/sources/dates";
import { FetchError, type Candidate } from "@aihot/backend/sources/types";

const BASE = "https://maimai.cn";
const USER_AGENT = "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36";

function headers(cookie?: string | null): Record<string, string> {
  return { ...(cookie ? { cookie } : {}), accept: "text/html", "user-agent": USER_AGENT };
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

function flightPayload(html: string): string {
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
  return flight;
}

/** Only accept the official hot-topic array, never the personalized feed or company-circle posts. */
export function parseHotRank(html: string): Candidate[] {
  const flight = flightPayload(html);
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

export type TopicPost = Candidate & { likes: number; comments: number };
export type TopicView = "share" | "crtime";

function postCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function parseTopicPosts(html: string, view: TopicView): TopicPost[] {
  let rows: unknown;
  if (view === "share") {
    const data = load(html)("#__NEXT_DATA__").text();
    if (data) rows = getPath(JSON.parse(data), "props.pageProps.topicFeeds");
  } else {
    const flight = flightPayload(html);
    const marker = '"listDefault":[';
    const at = flight.indexOf(marker);
    if (at >= 0) rows = jsonArrayAt(flight, at + marker.length - 1);
  }
  if (!Array.isArray(rows)) throw new FetchError(`Maimai ${view === "share" ? "topicFeeds" : "topic post list"} not found`);
  const posts: TopicPost[] = [];
  for (const row of rows) {
    if (!row || row.shareable !== 1 || typeof row.text !== "string") continue;
    const id = String(row.id ?? ""), egid = row.egid;
    if (!/^\d+$/.test(id) || typeof egid !== "string" || !/^[a-f0-9]{32}$/i.test(egid)) continue;
    const bodyText = stripTags(row.text);
    const title = (typeof row.title === "string" ? collapseWhitespace(stripTags(row.title)) : "") || collapseWhitespace(bodyText);
    if (!title) continue;
    const author = getPath(row, "author_info.name");
    const seconds = String(row.publish_time ?? "");
    posts.push({
      url: `${BASE}/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, title, bodyText,
      author: typeof author === "string" ? author.trim() : null,
      excerpt: collapseWhitespace(bodyText).slice(0, 2000),
      publishedAt: /^\d{10}$/.test(seconds) ? new Date(Number(seconds) * 1000) : null,
      raw: { externalId: id }, likes: postCount(row.likes), comments: postCount(row.cmts),
    });
  }
  return posts;
}

export async function fetchTopicPosts(topicUrl: string, view: TopicView, cookie: string | null): Promise<TopicPost[]> {
  const topicId = new URL(topicUrl).searchParams.get("topic_id");
  if (!topicId || !/^[\w-]{1,40}$/.test(topicId)) throw new FetchError("Invalid Maimai topic ID");
  const url = view === "share" ? `${BASE}/n/content/global-topic?circle_type=9&topic_id=${topicId}` : `${BASE}/community/topic-detail/${topicId}/${view}`;
  const res = await fetchListing(url, { redirectPolicy: "same-origin", headers: headers(view === "share" ? null : cookie), timeoutMs: 12_000 });
  if (new URL(res.url).pathname.includes("/login")) throw new FetchError(`Maimai ${view} topic requires login`, 401);
  if (res.status !== 200) throw new FetchError(`Maimai ${view} topic unavailable`, res.status);
  return parseTopicPosts(res.text(), view);
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
