// Discover public hot topics and posts; no comments, private identifiers or model calls are retained here.
import { MAIMAI_COLLECTION } from "@aihot/site";
import { credential } from "@aihot/backend/config";
import { fetchAuthenticatedHotRank, fetchPostTimes, fetchTopicPosts, type TopicPost, type TopicView } from "./authenticated.ts";
import { sql } from "@aihot/backend/db";
import { defineQueue, type ServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { upsertMaterial, FUTURE_TOLERANCE_MS, type MaterialInput } from "@aihot/backend/content/materials";
import { recordFetch } from "@aihot/backend/sources/collect";
import { noiseFiltered } from "@aihot/backend/sources/filters";
import { FetchError, type Candidate, type SourceRow } from "@aihot/backend/sources/types";

import scope from "./scope.json" with { type: "json" };

export const SOURCE_ID = MAIMAI_COLLECTION.sourceId;
export const NOTICE = "未经独立核实";
const DAY = 86400000;
const WEEK = 7 * 86400000;
const MAX_DATE_LOOKUPS = 24;
const MAX_POSTS_PER_TOPIC = 5;

function canonicalTopicUrl(input: string): string | null {
  const url = URL.parse(input);
  const topicId = url?.searchParams.get("topic_id");
  if (url?.origin !== "https://maimai.cn" || url.pathname !== "/n/content/global-topic" || !topicId || !/^[\w-]{1,40}$/.test(topicId)) return null;
  return `https://maimai.cn/n/content/global-topic?circle_type=9&topic_id=${topicId}`;
}

function heat(post: TopicPost): number {
  return post.likes + 2 * post.comments;
}

function publicPostId(post: Candidate): string | null {
  const id = String((post.raw as { externalId?: unknown } | null)?.externalId ?? "");
  const url = URL.parse(post.url);
  if (!/^\d+$/.test(id) || url?.origin !== "https://maimai.cn" || url.pathname !== `/n/content/gossip-detail/${id}`
    || url.searchParams.get("gid") !== id || !/^[a-f0-9]{32}$/i.test(url.searchParams.get("egid") ?? "")) return null;
  if (!post.bodyText || post.bodyText.trim().length < 20 || !post.author?.trim()) return null;
  return id;
}

export function postMaterial(post: Candidate, lead: Candidate, now: Date): (MaterialInput & { identityKey: string }) | null {
  const id = publicPostId(post);
  const at = post.publishedAt;
  if (!id || !at || !Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS || now.getTime() - at.getTime() > WEEK) return null;
  const url = new URL(post.url);
  const original = post.bodyText!.trim();
  const body = `原帖署名：${post.author}（未核验真实身份或任职）\n证据状态：${NOTICE}，用户发言不代表公司确认；听说、猜测与亲历必须分开。\n\n原帖正文：\n${original}`;
  // Keep only the post's public identity and topic link, never the page's user/profile/location fields.
  return { sourceId: SOURCE_ID, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${url.searchParams.get("egid")}&gid=${id}`,
    identityKey: `maimai:post:${id}`, title: post.title.slice(0, 100), author: post.author, publishedAt: at,
    bodyText: body, bodyStatus: "ok", language: "zh", excerpt: original.slice(0, 2000), via: "maimai",
    raw: { platform: "maimai", postId: id, topicUrl: canonicalTopicUrl(lead.url) } };
}

export async function collectMaimai(readers: { posts?: typeof fetchTopicPosts; rank?: typeof fetchAuthenticatedHotRank; times?: typeof fetchPostTimes } = {}) {
  if (process.env.COLLECT_ENABLED !== "true") return { skipped: "collection-disabled" };
  const [source] = await sql<(SourceRow & { next_fetch_at: Date })[]>`SELECT * FROM sources WHERE id = ${SOURCE_ID}`;
  if (!source?.enabled) return { skipped: "source-disabled" };
  if (source.next_fetch_at > new Date()) return { skipped: "not-due" };
  if (source.kind !== "external" || source.participation_mode !== "editorial" || source.config.publicationNotice !== NOTICE) throw new Error("Maimai source publication policy changed");
  const [run] = await sql<{ id: number }[]>`INSERT INTO fetch_runs (source_id) VALUES (${SOURCE_ID}) RETURNING id`;
  const cookie = credential("collectors", "MAIMAI_COOKIE");
  const filter = { ...source, config: { ingestNoiseFilter: scope } };
  const candidates = new Map<string, { post: TopicPost; lead: Candidate }>();
  const seen = { share: new Set<string>(), crtime: new Set<string>() };
  let highHeat = 0, latestTopics = 0, latestOnlyHighHeat = 0;
  let found = 0, created = 0, revised = 0, missingDates = 0, dateLookups = 0, readableTopics = 0;
  const errors: string[] = [];
  let rankError: string | null = null;
  let snapshot = source.cursor?.hotTopics as { fetchedAt: number; topics: Candidate[] } | undefined;
  let dateLookupAfter = String(source.cursor?.dateLookupAfter ?? "");
  const cursor = () => ({ initializedAt: source.cursor?.initializedAt ?? new Date().toISOString(), hotTopics: snapshot, dateLookupAfter });
  const detail = () => ({
    topics: snapshot?.topics.length ?? 0, readableTopics, latestTopics,
    uniquePosts: new Set([...seen.share, ...seen.crtime]).size,
    latestOnly: [...seen.crtime].filter(id => !seen.share.has(id)).length,
    relevant: candidates.size, highHeat, latestOnlyHighHeat, revised, missingDates, dateLookups, errors, rankError,
  });
  try {
    try {
      if (!cookie) throw new FetchError("Maimai session is not configured");
      snapshot = { fetchedAt: Date.now(), topics: await (readers.rank ?? fetchAuthenticatedHotRank)(cookie) };
    } catch (error) {
      rankError = error instanceof Error ? error.message : String(error);
      if (!snapshot || Date.now() - snapshot.fetchedAt >= DAY) throw error;
    }
    let readLatest = !!cookie && !rankError;
    for (const lead of snapshot.topics) {
      const url = canonicalTopicUrl(lead.url);
      if (!url) continue;
      const views: TopicView[] = readLatest ? ["share", "crtime"] : ["share"];
      const results = await Promise.allSettled(views.map(view => (readers.posts ?? fetchTopicPosts)(url, view, cookie)));
      const relevantLead = !noiseFiltered(lead, filter);
      let readable = false;
      for (const [index, result] of results.entries()) {
        const view = views[index]!;
        if (result.status === "rejected") {
          const error = result.reason;
          errors.push(`${lead.title} (${view}): ${error instanceof Error ? error.message : String(error)}`);
          if (view === "crtime" && error instanceof FetchError && [401, 403, 429].includes(error.status ?? 0)) readLatest = false;
          continue;
        }
        readable = true;
        if (view === "crtime") latestTopics++;
        found += result.value.length;
        for (const post of result.value) {
          const id = publicPostId(post);
          if (!id) continue;
          seen[view].add(id);
          if (!relevantLead && noiseFiltered({ ...post, title: `${post.title}\n${post.bodyText}` }, filter)) continue;
          const previous = candidates.get(id)?.post;
          candidates.set(id, { lead: candidates.get(id)?.lead ?? lead, post: {
            ...(previous ?? post), publishedAt: previous?.publishedAt ?? post.publishedAt,
            likes: Math.max(previous?.likes ?? 0, post.likes), comments: Math.max(previous?.comments ?? 0, post.comments),
          } });
        }
      }
      if (readable) readableTopics++;
    }
    if (!readableTopics) throw new FetchError(errors.join("; ").slice(0, 1500) || "No readable Maimai hot topics");

    const popular = [...candidates].filter(([, { post }]) => post.likes >= 10 || post.comments >= 5)
      .sort(([, a], [, b]) => heat(b.post) - heat(a.post));
    highHeat = popular.length;
    latestOnlyHighHeat = popular.filter(([id]) => !seen.share.has(id)).length;
    const undated = popular.filter(([, { post }]) => !post.publishedAt).map(([id]) => id);
    const times = new Map<string, Date>();
    if (undated.length) {
      const stored = await sql<{ identity_key: string; published_at: Date }[]>`SELECT identity_key, published_at FROM articles
        WHERE source_id = ${SOURCE_ID} AND published_at IS NOT NULL AND identity_key IN ${sql(undated.map(id => `maimai:post:${id}`))}`;
      for (const row of stored) times.set(row.identity_key.slice("maimai:post:".length), row.published_at);
    }
    if (cookie && !rankError) {
      const offset = undated.indexOf(dateLookupAfter) + 1;
      for (const id of [...undated.slice(offset), ...undated.slice(0, offset)]) {
        if (times.has(id)) continue;
        const { post } = candidates.get(id)!;
        const query = post.title.replace(/[\s\p{P}]+/gu, " ").trim().slice(0, 15);
        if (!query) continue;
        dateLookupAfter = id;
        dateLookups++;
        try {
          const results = await (readers.times ?? fetchPostTimes)(cookie, query);
          for (const [matchedId, time] of results) if (!times.has(matchedId)) times.set(matchedId, time);
        } catch (error) {
          errors.push(`Post time lookup: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
        if (dateLookups >= MAX_DATE_LOOKUPS) break;
      }
    }
    const keptByTopic = new Map<string, number>();
    for (const [id, { post, lead }] of popular) {
      const publishedAt = post.publishedAt ?? times.get(id);
      if (!publishedAt) { missingDates++; continue; }
      const kept = keptByTopic.get(lead.url) ?? 0;
      if (kept >= MAX_POSTS_PER_TOPIC) continue;
      const material = postMaterial({ ...post, publishedAt }, lead, new Date());
      if (!material) continue;
      keptByTopic.set(lead.url, kept + 1);
      const result = await upsertMaterial({ ...material, backfill: source.cursor?.initializedAt ? null : "source-first-import" });
      created += Number(result.created); revised += Number(result.revised);
      if (result.created || result.revised || result.processingNeeded) await queueProcessing(result.articleId);
    }
    if (rankError) throw new FetchError(`Maimai hot rank unavailable; used cached topics: ${rankError}`);
    if (missingDates && missingDates === highHeat) throw new FetchError("Maimai posts have no usable publication times");
    await recordFetch(sql, SOURCE_ID, run!.id, { found, created, detail: detail(), cursor: cursor() });
    return { found, created, ...detail() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (snapshot) await sql`UPDATE sources SET cursor = coalesce(sources.cursor, '{}'::jsonb) || ${sql.json({ hotTopics: snapshot, dateLookupAfter } as never)}::jsonb WHERE id = ${SOURCE_ID}`;
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
        WHERE id = ${SOURCE_ID} AND enabled AND (next_fetch_at IS NULL OR next_fetch_at <= now())`;
      if (due) await enqueueOn(collectQueue, {}, { singletonKey: SOURCE_ID });
    } }],
} satisfies ServerModule;
