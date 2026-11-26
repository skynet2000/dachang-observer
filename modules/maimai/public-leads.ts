import { load } from "cheerio";
import { sql } from "@aihot/backend/db";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { noiseFiltered } from "@aihot/backend/sources/filters";
import { fetchTopicPosts, type TopicPost } from "./authenticated.ts";
import scope from "./scope.json" with { type: "json" };

const STATE = "maimai.public-leads";
const FEED = "https://decemberpei.cyou/rssbox/maimai_hot.xml";
const BACKUP = "https://api.whatshot.top/pro-communities/maimai-hot";
const HISTORY_DAYS = 30;
const LEADS_PER_PAGE = 50;
export const PUBLIC_LEAD_QUIET_MS = 24 * 3600_000;

async function readBackupTopics() {
  const response = await fetchListing(BACKUP, { timeoutMs: 12000 });
  if (response.status !== 200) throw new Error(`备用热榜 HTTP ${response.status}`);
  return publicBackupHotTopics(JSON.parse(response.text()));
}

async function readTopics(errors: string[]) {
  try {
    const r = await fetchListing(FEED, { timeoutMs: 12000 });
    if (r.status !== 200) throw new Error(`公开热榜 HTTP ${r.status}`);
    const primary = publicHotTopics(r.text());
    const backup = await readBackupTopics().catch(() => []);
    const topics = [...new Set([...primary, ...backup])].slice(0, 18);
    const source = topics.length > primary.length ? "rss+whatshot" : "rss";
    await saveTopics(topics, source);
    return { topics, source };
  } catch {
    try {
      const topics = await readBackupTopics();
      await saveTopics(topics, "whatshot");
      return { topics, source: "whatshot" };
    } catch (error) {
      const [cached] = await sql`SELECT value FROM settings WHERE key=${STATE+".topics"}`;
      if (!cached || Date.now()-cached.value.fetchedAt > 2*86400000) throw error;
      errors.push("两个公开热榜入口均不可用，正在跟踪48小时内已核验的话题");
      return { topics: cached.value.topics as string[], source: "cache" };
    }
  }
}

async function saveTopics(topics: string[], source: string) {
  const value = { topics, source, fetchedAt: Date.now() };
  await sql`INSERT INTO settings(key,value,updated_by) VALUES(${STATE+".topics"},${sql.json(value)},'maimai-public-collector')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
}

function officialTopics(links: string[]): string[] {
  const topics = new Set<string>();
  for (const link of links) {
    try {
      const url = new URL(link);
      const id = url.searchParams.get("topic_id");
      if (url.origin === "https://maimai.cn" && url.pathname === "/n/content/global-topic" && id && /^[\w-]{1,40}$/.test(id)) {
        topics.add(`https://maimai.cn/n/content/global-topic?circle_type=9&topic_id=${id}`);
      }
    } catch { /* A placeholder or malformed entry is not a topic. */ }
  }
  if (topics.size < 3) throw new Error("公开热榜缺少有效话题，可能是第三方错误占位或入口失效");
  return [...topics].slice(0, 15);
}

export function publicHotTopics(xml: string): string[] {
  const $ = load(xml, { xmlMode: true });
  return officialTopics($("item link").toArray().map(item => $(item).text()));
}

export function publicBackupHotTopics(value: unknown, now = Date.now()): string[] {
  if (!value || typeof value !== "object") throw new Error("备用热榜格式错误");
  const data = value as { code?: unknown; updateTime?: unknown; data?: unknown };
  const updated = typeof data.updateTime === "string" ? Date.parse(data.updateTime) : NaN;
  if (data.code !== 200 || !Number.isFinite(updated) || updated > now + 5*60000 || updated < now - 4*3600000 || !Array.isArray(data.data)) {
    throw new Error("备用热榜过期或格式错误");
  }
  return officialTopics(data.data.map((item: { url?: unknown }) => typeof item?.url === "string" ? item.url : ""));
}

function inspectPublicLead(post: TopicPost, topic: string, now = Date.now()) {
  let url: URL;
  try { url = new URL(post.url); } catch { return "link"; }
  const id = /^\/n\/content\/gossip-detail\/(\d+)$/.exec(url.pathname)?.[1];
  const egid = url.searchParams.get("egid");
  if (url.origin !== "https://maimai.cn" || !id || url.searchParams.get("gid") !== id || !egid || !/^[a-f0-9]{32}$/i.test(egid)) return "link";
  if (![post.likes,post.comments].every(n => Number.isSafeInteger(n) && n >= 0)) return "interaction";
  if (post.likes < 5 && post.comments < 5) return "lowInteraction";
  if (post.publishedAt && (!Number.isFinite(post.publishedAt.getTime()) || post.publishedAt.getTime() > now || post.publishedAt.getTime() < now-7*86400000)) return "date";
  const filter = { config: { ingestNoiseFilter: scope } } as unknown as Parameters<typeof noiseFiltered>[1];
  if (!post.bodyText || noiseFiltered({ ...post, title: `${post.title}\n${post.bodyText}` }, filter)) return "scope";
  return { id, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, topic, title: post.title.slice(0,100), excerpt: post.bodyText.slice(0,240),
    likes: post.likes, comments: post.comments, publishedAt: post.publishedAt ?? null };
}

export function publicLead(post: TopicPost, topic: string, now = Date.now()) {
  const result = inspectPublicLead(post, topic, now);
  return typeof result === "string" ? null : result;
}

export async function collectPublicLeads(readers: { topics?: () => Promise<string[]>; posts?: typeof fetchTopicPosts } = {}) {
  if (process.env.COLLECT_ENABLED !== "true") return { skipped: true };
  let found = 0, kept = 0;
  const errors: string[] = [];
  const seen = new Set<string>();
  try {
    const [previous] = await sql<{ value: { topics?: string[] } }[]>`SELECT value FROM settings WHERE key=${STATE + ".topics"}`;
    const { topics, source } = readers.topics ? { topics: await readers.topics(), source: "test" } : await readTopics(errors);
    const newTopics = topics.filter(topic => !previous?.value.topics?.includes(topic)).length;
    const rejected = { link: 0, interaction: 0, lowInteraction: 0, date: 0, scope: 0, duplicate: 0 };
    let newPosts = 0;
    let readable = 0;
    for (const topic of topics.slice(0,18)) {
      try {
        const posts = await (readers.posts ?? fetchTopicPosts)(topic,"share",null);
        readable++;
        found += posts.length;
        for (const post of posts) {
          const lead = inspectPublicLead(post, topic);
          if (typeof lead === "string") { rejected[lead]++; continue; }
          if (seen.has(lead.id)) { rejected.duplicate++; continue; }
          seen.add(lead.id);
          const [saved] = await sql<{ is_new: boolean }[]>`INSERT INTO maimai_public_leads(post_id,url,topic_url,title,excerpt,likes,comments,published_at)
            VALUES(${lead.id},${lead.url},${topic},${lead.title},${lead.excerpt},${lead.likes},${lead.comments},${lead.publishedAt})
            ON CONFLICT(post_id) DO UPDATE SET likes=EXCLUDED.likes,comments=EXCLUDED.comments,last_seen_at=now(),
              published_at=coalesce(maimai_public_leads.published_at,EXCLUDED.published_at)
            RETURNING first_seen_at = last_seen_at AS is_new`;
          newPosts += Number(saved?.is_new ?? false);
          kept++;
        }
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (!readable) throw new Error(errors[0] ?? "没有可读的公开话题");
    await sql`DELETE FROM maimai_public_leads WHERE first_seen_at < now()-${HISTORY_DAYS}::int*interval '1 day'`;
    const [latest] = await sql<{ last_new_at: Date | null }[]>`SELECT max(first_seen_at) AS last_new_at FROM maimai_public_leads WHERE visible`;
    const result = { found, kept, newPosts, newTopics, rejected, lastNewAt: latest?.last_new_at?.toISOString() ?? null, readable, topics: topics.length, source };
    await saveState({ ...result, ok: errors.length === 0, checkedAt: new Date().toISOString(), errors: errors.slice(0,3) });
    return { ...result, errors };
  } catch (error) {
    await saveState({ ok: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function saveState(value: Record<string, unknown>) {
  await sql`INSERT INTO settings(key,value,updated_by) VALUES(${STATE},${sql.json(value as never)},'maimai-public-collector')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
}

/** Independent public projection. These observations never enter news, reports, ranking or RSS. */
export async function readPublicLeads(history = false, requestedPage = 1) {
  const [status] = await sql`SELECT value FROM settings WHERE key=${STATE}`;
  const window = history
    ? sql`first_seen_at >= now()-${HISTORY_DAYS}::int*interval '1 day'`
    : sql`last_seen_at > now()-interval '2 days' AND first_seen_at > now()-interval '7 days'`;
  let page = 1, pageCount = 1;
  if (history) {
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM maimai_public_leads WHERE visible AND ${window}`;
    pageCount = Math.max(1, Math.ceil((row?.count ?? 0) / LEADS_PER_PAGE));
    if (Number.isSafeInteger(requestedPage)) page = Math.max(1, Math.min(requestedPage, pageCount));
  }
  const items = await sql`SELECT post_id AS id,url,topic_url AS "topicUrl",title,left(excerpt,240) AS excerpt,likes,comments,published_at AS "publishedAt",
    first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt" FROM maimai_public_leads
    WHERE visible AND ${window}
    ORDER BY first_seen_at DESC,post_id DESC LIMIT ${LEADS_PER_PAGE} OFFSET ${(page-1)*LEADS_PER_PAGE}`;
  return { status: status?.value ?? null, items, ...(history ? { page, pageCount } : {}) };
}
