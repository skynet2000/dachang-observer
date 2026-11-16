import { load } from "cheerio";
import { sql } from "@aihot/backend/db";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { noiseFiltered } from "@aihot/backend/sources/filters";
import { fetchTopicPosts, type TopicPost } from "./authenticated.ts";
import scope from "./scope.json" with { type: "json" };

const STATE = "maimai.public-leads";
const FEED = "https://decemberpei.cyou/rssbox/maimai_hot.xml";
const BACKUP = "https://api.whatshot.top/pro-communities/maimai-hot";

async function readTopics(errors: string[]) {
  try {
    const r = await fetchListing(FEED, { timeoutMs: 12000 });
    if (r.status !== 200) throw new Error(`公开热榜 HTTP ${r.status}`);
    const topics = publicHotTopics(r.text());
    await saveTopics(topics, "rss");
    return { topics, source: "rss" };
  } catch {
    try {
      const r = await fetchListing(BACKUP, { timeoutMs: 12000 });
      if (r.status !== 200) throw new Error(`备用热榜 HTTP ${r.status}`);
      const topics = publicBackupHotTopics(JSON.parse(r.text()));
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

export function publicLead(post: TopicPost, topic: string, now = Date.now()) {
  let url: URL;
  try { url = new URL(post.url); } catch { return null; }
  const id = /^\/n\/content\/gossip-detail\/(\d+)$/.exec(url.pathname)?.[1];
  const egid = url.searchParams.get("egid");
  if (url.origin !== "https://maimai.cn" || !id || url.searchParams.get("gid") !== id || !egid || !/^[a-f0-9]{32}$/i.test(egid)) return null;
  if (![post.likes,post.comments].every(n => Number.isSafeInteger(n) && n >= 0)) return null;
  if (post.likes < 5 && post.comments < 5) return null;
  if (post.publishedAt && (!Number.isFinite(post.publishedAt.getTime()) || post.publishedAt.getTime() > now || post.publishedAt.getTime() < now-7*86400000)) return null;
  const filter = { config: { ingestNoiseFilter: scope } } as unknown as Parameters<typeof noiseFiltered>[1];
  if (!post.bodyText || noiseFiltered({ ...post, title: `${post.title}\n${post.bodyText}` }, filter)) return null;
  return { id, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, topic, title: post.title.slice(0,100), excerpt: post.bodyText.slice(0,240),
    likes: post.likes, comments: post.comments, publishedAt: post.publishedAt ?? null };
}

export async function collectPublicLeads(readers: { topics?: () => Promise<string[]>; posts?: typeof fetchTopicPosts } = {}) {
  if (process.env.COLLECT_ENABLED !== "true") return { skipped: true };
  let found = 0, kept = 0;
  const errors: string[] = [];
  const seen = new Set<string>();
  try {
    const { topics, source } = readers.topics ? { topics: await readers.topics(), source: "test" } : await readTopics(errors);
    let readable = 0;
    for (const topic of topics.slice(0,15)) {
      try {
        const posts = await (readers.posts ?? fetchTopicPosts)(topic,"share",null);
        readable++;
        found += posts.length;
        for (const post of posts) {
          const lead = publicLead(post,topic);
          if (!lead || seen.has(lead.id)) continue;
          seen.add(lead.id);
          await sql`INSERT INTO maimai_public_leads(post_id,url,topic_url,title,excerpt,likes,comments,published_at)
            VALUES(${lead.id},${lead.url},${topic},${lead.title},${lead.excerpt},${lead.likes},${lead.comments},${lead.publishedAt})
            ON CONFLICT(post_id) DO UPDATE SET likes=EXCLUDED.likes,comments=EXCLUDED.comments,last_seen_at=now(),
              published_at=coalesce(maimai_public_leads.published_at,EXCLUDED.published_at)`;
          kept++;
        }
      } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (!readable) throw new Error(errors[0] ?? "没有可读的公开话题");
    await sql`DELETE FROM maimai_public_leads WHERE first_seen_at < now()-interval '7 days'`;
    await saveState({ ok: errors.length === 0, checkedAt: new Date().toISOString(), found, kept, readable, topics: topics.length, source, errors: errors.slice(0,3) });
    return { found, kept, readable, topics: topics.length, source, errors };
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
export async function readPublicLeads() {
  const [status] = await sql`SELECT value FROM settings WHERE key=${STATE}`;
  const items = await sql`SELECT post_id AS id,url,topic_url AS "topicUrl",title,left(excerpt,240) AS excerpt,likes,comments,published_at AS "publishedAt",
    first_seen_at AS "firstSeenAt",last_seen_at AS "lastSeenAt" FROM maimai_public_leads
    WHERE visible AND last_seen_at > now()-interval '2 days' AND first_seen_at > now()-interval '7 days'
    ORDER BY first_seen_at DESC,post_id DESC LIMIT 50`;
  return { status: status?.value ?? null, items };
}
