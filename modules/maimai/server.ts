// Public hot topics discover individual posts; no login, comments, private identifiers or model calls here.
import { MAIMAI_COLLECTION } from "@aihot/site";
import { sql } from "@aihot/backend/db";
import { defineQueue, type ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { upsertMaterial, FUTURE_TOLERANCE_MS, type MaterialInput } from "@aihot/backend/content/materials";
import { recordFetch } from "@aihot/backend/sources/collect";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { noiseFiltered } from "@aihot/backend/sources/filters";
import { FetchError, type Candidate, type SourceRow } from "@aihot/backend/sources/types";

export const SOURCE_ID = MAIMAI_COLLECTION.sourceId;
export const NOTICE = "未经独立核实";
const LEADS_ID = "rss-maimai-hot";
const DAY = 86400000;
const WEEK = 7 * 86400000;
const MAX_TOPICS = 15;
const MAX_POSTS_PER_TOPIC = 5;

function canonicalTopicUrl(input: string): string | null {
  const url = URL.parse(input);
  const topicId = url?.searchParams.get("topic_id");
  if (url?.origin !== "https://maimai.cn" || url.pathname !== "/n/content/global-topic" || !topicId || !/^[\w-]{1,40}$/.test(topicId)) return null;
  return `https://maimai.cn/n/content/global-topic?circle_type=9&topic_id=${topicId}`;
}

export function topicSource(lead: Candidate, source: SourceRow): SourceRow | null {
  const url = canonicalTopicUrl(lead.url);
  if (!url) return null;
  return { ...source, kind: "json_list", config: {
    url,
    mode: "html_json_key", jsonKey: "topicFeeds", itemsPath: "topicFeeds",
    titlePaths: ["title", "text"], summaryPaths: ["text"], summaryIsBody: true,
    authorPaths: ["author_info.name"], publishedAtPath: "publish_time", publishedAtUnit: "epoch_s",
    externalIdPath: "id", requireBoolean: { path: "shareable", equals: 1 },
    urlTemplate: "https://maimai.cn/n/content/gossip-detail/{id}?egid={egid}&gid={id}",
  } };
}

export function postMaterial(post: Candidate, lead: Candidate, now: Date): (MaterialInput & { identityKey: string }) | null {
  const id = String((post.raw as { externalId?: unknown } | null)?.externalId ?? "");
  const url = new URL(post.url);
  const at = post.publishedAt;
  if (!/^\d+$/.test(id) || url.origin !== "https://maimai.cn" || url.pathname !== `/n/content/gossip-detail/${id}`
    || url.searchParams.get("gid") !== id || !/^[a-f0-9]{32}$/i.test(url.searchParams.get("egid") ?? "")) return null;
  if (!at || !Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS || now.getTime() - at.getTime() > WEEK) return null;
  if (!post.bodyText || post.bodyText.trim().length < 20 || !post.author?.trim()) return null;
  const original = post.bodyText.trim();
  const body = `原帖署名：${post.author}（未核验真实身份或任职）\n证据状态：${NOTICE}，用户发言不代表公司确认；听说、猜测与亲历必须分开。\n\n原帖正文：\n${original}`;
  // Keep only the post's public identity and topic link, never the page's user/profile/location fields.
  return { sourceId: SOURCE_ID, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${url.searchParams.get("egid")}&gid=${id}`,
    identityKey: `maimai:post:${id}`, title: post.title.slice(0, 100), author: post.author, publishedAt: at,
    bodyText: body, bodyStatus: "ok", language: "zh", excerpt: original.slice(0, 2000), via: "maimai",
    raw: { platform: "maimai", postId: id, topicUrl: canonicalTopicUrl(lead.url) } };
}

export async function collectMaimai(readers: { rss?: typeof fetchRss; posts?: typeof fetchJsonList } = {}) {
  if (process.env.COLLECT_ENABLED !== "true") return { skipped: "collection-disabled" };
  const [source] = await sql<(SourceRow & { next_fetch_at: Date })[]>`SELECT * FROM sources WHERE id = ${SOURCE_ID}`;
  const [leads] = await sql<SourceRow[]>`SELECT * FROM sources WHERE id = ${LEADS_ID}`;
  if (!source?.enabled || !leads?.enabled) return { skipped: "source-disabled" };
  if (source.next_fetch_at > new Date()) return { skipped: "not-due" };
  if (source.kind !== "external" || source.participation_mode !== "editorial" || source.config.publicationNotice !== NOTICE) throw new Error("Maimai source publication policy changed");
  const [run] = await sql<{ id: number }[]>`INSERT INTO fetch_runs (source_id) VALUES (${SOURCE_ID}) RETURNING id`;
  let found = 0, created = 0, revised = 0, rejected = 0;
  const errors: string[] = [];
  let topics: Candidate[] = [];
  let readableTopics = 0;
  let rssError: string | null = null;
  let snapshot = source.cursor?.hotTopics as { fetchedAt: number; topics: Candidate[] } | undefined;
  const detail = () => ({ topics: topics.length, readableTopics, rejected, revised, errors, rssError });
  try {
    try {
      const rss = await (readers.rss ?? fetchRss)(leads, { force: true });
      const unique = new Map<string, Candidate>();
      for (const lead of rss.candidates) {
        const url = canonicalTopicUrl(lead.url);
        if (url && !unique.has(url)) unique.set(url, { url, title: lead.title, excerpt: lead.excerpt });
        if (unique.size >= MAX_TOPICS) break;
      }
      if (!unique.size) throw new FetchError("Maimai RSS contains no valid hot-topic links");
      snapshot = { fetchedAt: Date.now(), topics: [...unique.values()] };
    } catch (error) {
      rssError = error instanceof Error ? error.message : String(error);
      if (!snapshot || Date.now() - snapshot.fetchedAt >= DAY) throw error;
    }
    topics = snapshot.topics;
    const seen = new Set<string>();
    for (const lead of topics) {
      const draft = topicSource(lead, source);
      if (!draft) continue;
      let posts: Candidate[];
      try {
        posts = await (readers.posts ?? fetchJsonList)(draft);
        if (!posts.length) throw new FetchError("Public topic contains no readable posts");
      } catch (error) {
        errors.push(`${lead.title}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      readableTopics++;
      found += posts.length;
      const relevantLead = !noiseFiltered(lead, leads);
      let kept = 0;
      for (const post of posts) {
        if (kept >= MAX_POSTS_PER_TOPIC) break;
        const material = postMaterial(post, lead, new Date());
        // A vague hot-topic headline can lead to a useful post. In that case the post itself must
        // supply both the employer and the workplace context before the usual editorial review.
        if (!material || (!relevantLead && noiseFiltered({ ...post, title: `${post.title}\n${post.bodyText}` }, leads))) {
          rejected++;
          continue;
        }
        if (seen.has(material.identityKey)) continue;
        seen.add(material.identityKey);
        kept++;
        const result = await upsertMaterial({ ...material, backfill: source.cursor?.initializedAt ? null : "source-first-import" });
        created += Number(result.created); revised += Number(result.revised);
        if (result.created || result.revised || result.processingNeeded) await queueProcessing(result.articleId);
      }
    }
    if (!readableTopics) throw new FetchError(errors.join("; ").slice(0, 1500) || "No readable Maimai hot topics");
    await recordFetch(sql, SOURCE_ID, run!.id, { found, created, detail: detail(),
      cursor: { initializedAt: source.cursor?.initializedAt ?? new Date().toISOString(), hotTopics: snapshot } });
    return { found, created, ...detail() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFetch(sql, SOURCE_ID, run!.id, { found, created, detail: detail(), error: message, budget: false, maxBackoffMinutes: MAIMAI_COLLECTION.maxBackoffMinutes });
    throw error;
  }
}

export const collectQueue = defineQueue<Record<string, never>>({
  name: "maimai.collect", options: { policy: "short", retryLimit: 0, expireInSeconds: 600 },
  worker: { localConcurrency: 1, pollingIntervalSeconds: 5 }, run: async () => collectMaimai(),
});

export default {
  name: "maimai", queues: [collectQueue],
  schedules: [{ name: "maimai.poll", cron: "* * * * *", when: () => process.env.COLLECT_ENABLED === "true",
    run: async () => {
      const [due] = await sql`
        SELECT 1 FROM sources
        WHERE id = ${SOURCE_ID} AND enabled AND (next_fetch_at IS NULL OR next_fetch_at <= now())
          AND EXISTS (SELECT 1 FROM sources WHERE id = ${LEADS_ID} AND enabled)`;
      if (due) await enqueueOn(collectQueue, {}, { singletonKey: SOURCE_ID });
    } }],
} satisfies ServerModule;
