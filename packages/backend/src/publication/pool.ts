import { loadHotStrip } from "./hot.ts";
// Public pool (/all) with numeric pages, and search in its two orderings.
import type { PoolResponse, TimelineFilters } from "@aihot/contracts/site";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { one, sql, withCustomPlans, type Db } from "../db.ts";
import { sharedSearch } from "../lib/cache.ts";
import {
  reportTime, categoryCondition, channelCondition, ITEM_COLUMNS, ITEM_FROM, seatHolders, tagCondition, toFeedItemSummary,
  type ItemRow,
} from "./items.ts";
import { foldableSelectionCondition, listedCondition, ownFactEvidenceCondition } from "./scope.ts";
import { eventEntries } from "./event-entries.ts";
import { TOPICS } from "./topics.ts";

export const POOL_PAGE_SIZE = 40;
export const POOL_MAX_PAGES = 50;

export class SearchBusyError extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super("search capacity exhausted");
    this.retryAfter = retryAfter;
  }
}

// Search capacity guard: bounded concurrency with a short queue. Overflow answers 503 + Retry-After
// instead of letting machine traffic drag list browsing down.
const MAX_CONCURRENT_SEARCHES = 4;
const MAX_QUEUED_SEARCHES = 8;
let running = 0;
const waiters: Array<() => void> = [];

export async function withSearchCapacity<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_SEARCHES) {
    if (waiters.length >= MAX_QUEUED_SEARCHES) throw new SearchBusyError(5);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(go);
        if (i >= 0) waiters.splice(i, 1);
        reject(new SearchBusyError(5));
      }, 3000);
      const go = () => {
        clearTimeout(timer);
        resolve();
      };
      waiters.push(go);
    });
  }
  running += 1;
  try {
    return await withCustomPlans(fn);
  } finally {
    running -= 1;
    waiters.shift()?.();
  }
}

/** Search terms: whitespace separated, lower-cased, LIKE metacharacters escaped. */
export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => t.replace(/[\\%_]/g, (m) => `\\${m}`));
}

/** Default search: subject, title or summary match (search_text), newest first. */
export function directMatchCondition(terms: string[]) {
  if (terms.length === 0) return sql``;
  return terms.reduce((acc, t) => sql`${acc} AND p.search_text LIKE ${"%" + t + "%"}`, sql``);
}

const normalizeAlias = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The company a whole query names: a company topic's slug, full name,
 * each part of "OpenAI / ChatGPT" and its other names. Then the search also takes the articles about
 * that company (their subject tag), so "claude" finds Anthropic's news that never writes the word.
 * Only the whole query counts: "deepseek v4" stays a text search, not all of DeepSeek.
 */
function queryEntityTag(q: string): string | null {
  const want = normalizeAlias(q);
  if (!want) return null;
  const topic = TOPICS.find((t) => t.entityId && t.aliases.some((a) => normalizeAlias(a) === want));
  return topic ? `entity:${topic.entityId}` : null;
}

/**
 * The public APIs' q (v1 and MCP): every term matches the subject, title or summary, or the start of a
 * body whose full text may be shown, as the API documents it ("title / Chinese title / Chinese summary
 * / body"). Results stay in time order.
 */
export function publicMatchCondition(terms: string[]) {
  if (terms.length === 0) return sql``;
  // Keep the body lookup correlated to the time-ordered candidates. Without OFFSET 0, PostgreSQL
  // may hash every matching body in pool_search before serving even the first 40 recent items.
  return terms.reduce(
    (acc, t) => sql`${acc} AND (p.search_text LIKE ${"%" + t + "%"} OR EXISTS (
      SELECT 1 FROM pool_search ps WHERE ps.article_id = p.article_id AND ps.body LIKE ${"%" + t + "%"} OFFSET 0))`,
    sql``,
  );
}

export interface PoolQuery extends TimelineFilters {
  q?: string | null;
  tab?: "time" | "relevance";
  page?: number;
  now?: Date;
}

// Identical searches share their read before taking search capacity.
const searchPool = sharedSearch(
  (q: PoolQuery) => JSON.stringify([q.channel, q.category, q.tag, q.q, q.tab, q.page]),
  queryPool, (q) => !!q.q?.trim(),
);

export function loadPool(query: PoolQuery): Promise<PoolResponse> {
  return searchPool(query, query.now);
}

async function queryPool(query: PoolQuery, now: Date): Promise<PoolResponse> {
  const page = Math.min(Math.max(query.page ?? 1, 1), POOL_MAX_PAGES);
  const q = query.q?.trim() || null;
  const tab = q && query.tab === "relevance" ? "relevance" : "time";
  const terms = q ? searchTerms(q) : [];
  const entityTag = q ? queryEntityTag(q) : null;
  const filters = sql`${channelCondition(query.channel)} ${categoryCondition(query.category)} ${tagCondition(query.tag)}`;
  const reportScope = sql`${ownFactEvidenceCondition()} AND ${listedCondition(now)} ${filters}`;
  const offset = (page - 1) * POOL_PAGE_SIZE;
  const cap = POOL_MAX_PAGES * POOL_PAGE_SIZE;
  const todayStart = beijingMidnight(beijingDate(now));

  // Searches go through pool_search (eligible items only): trigram indexes for longer terms, a small
  // table to scan for one- and two-character ones.
  const matchOrSubject = (text: ReturnType<typeof directMatchCondition>) => (entityTag ? sql`AND (p.tags @> ${[entityTag]}::text[] OR (TRUE ${text}))` : text);
  const like = (col: ReturnType<typeof sql>, t: string) => sql`${col} LIKE ${"%" + t + "%"}`;
  // One entry per confirmed event, led by its latest development. Repeated reports of an older
  // fact cannot move it ahead; filters and search still choose among matching reports first.
  type GroupedRow = ItemRow & { anchor_at: Date; group_public_id: string | null; group_story_id: number | null; development_count: number; report_count: number; source_count: number; rel: number };
  const groupedPage = async (db: Db, candidates: ReturnType<typeof sql>) => {
    const result = await db<(Omit<GroupedRow, "id"> & { id: string | null; total: number; today_count: number })[]>`
      WITH ${eventEntries(candidates)}, page AS MATERIALIZED (
        SELECT * FROM entries ORDER BY rel DESC, anchor_at DESC, article_id DESC
        LIMIT ${POOL_PAGE_SIZE} OFFSET ${offset}
      ), total AS (
        SELECT (SELECT count(*) FROM (SELECT 1 FROM entries LIMIT ${cap}) capped) AS n,
               ${q ? sql`0` : sql`(SELECT count(*) FROM entries WHERE anchor_at >= ${todayStart})`} AS today_count
      )
      SELECT hydrated.*, total.n AS total, total.today_count FROM total LEFT JOIN LATERAL (
        SELECT ${ITEM_COLUMNS}, page.anchor_at, page.rel, reports.report_count, reports.source_count, reports.development_count,
          f.public_id AS group_public_id, page.story_id AS group_story_id
        ${ITEM_FROM} JOIN page ON page.article_id = p.article_id LEFT JOIN facts f ON f.id = p.fact_id AND ${ownFactEvidenceCondition()} AND ${foldableSelectionCondition()}
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS report_count, count(DISTINCT source_id)::int AS source_count,
            count(DISTINCT fact_id)::int AS development_count
          FROM (
            SELECT p.source_id, p.fact_id
            FROM facts member_fact JOIN publications p ON p.fact_id = member_fact.id
            WHERE page.story_id IS NOT NULL AND member_fact.story_id = page.story_id AND ${reportScope}
            UNION ALL
            SELECT p.source_id, p.fact_id FROM publications p
            WHERE page.story_id IS NULL AND p.fact_id = f.id AND ${reportScope}
          ) members
        ) reports ON true
      ) hydrated ON true ORDER BY hydrated.rel DESC, hydrated.anchor_at DESC, hydrated.id DESC`;
    return { rows: result.filter((r): r is GroupedRow & { total: number; today_count: number } => r.id !== null),
      total: Number(result[0]!.total), todayCount: Number(result[0]!.today_count) };
  };
  const run = async (db: Db) => {
    if (!q) {
      return groupedPage(db, sql`SELECT p.article_id, 0 AS rel FROM publications p WHERE ${listedCondition(now)} ${filters}`);
    }
    if (tab === "relevance") {
      // Rank narrow rows first: no article bodies or translations enter the sort/count. The public
      // total stops at 2,000, even though ranking must consider every matching item.
      // For an unfiltered trigram search, match each indexed field separately. OR across fields
      // can make PostgreSQL scan every toasted body instead. Keep other searches inline so short
      // terms, additional terms and selective publication filters retain their existing plans.
      const splitFields = terms.length === 1 && /[\p{L}\p{N}]{3}/u.test(terms[0]!)
        && (!query.channel || query.channel === "all") && !query.category && !query.tag;
      const partScore = terms.reduce(
        (acc, t) => sql`${acc} + (CASE WHEN ${like(sql`ps.direct`, t)} THEN 3 ELSE 0 END) + (CASE WHEN ${like(sql`ps.body`, t)} THEN 1 ELSE 0 END)`,
        sql`0`,
      );
      const titleScore = terms.reduce((acc, t) => sql`${acc} + (CASE WHEN ${like(sql`lower(p.title)`, t)} THEN 6 ELSE 0 END)`, sql`0`);
      const anyMatch = terms.reduce((acc, t) => sql`${acc} AND (${like(sql`ps.direct`, t)} OR ${like(sql`ps.body`, t)})`, sql`TRUE`);
      const matches = splitFields ? sql`
        SELECT coalesce(d.article_id, b.article_id) AS article_id,
          (CASE WHEN d.article_id IS NOT NULL THEN 3 ELSE 0 END) + (CASE WHEN b.article_id IS NOT NULL THEN 1 ELSE 0 END) AS part
        FROM (SELECT article_id FROM pool_search WHERE direct LIKE ${"%" + terms[0]! + "%"}) d
        FULL JOIN (SELECT article_id FROM pool_search WHERE body LIKE ${"%" + terms[0]! + "%"}) b ON b.article_id = d.article_id`
        : sql`SELECT ps.article_id, (${partScore}) AS part FROM pool_search ps WHERE ${anyMatch}`;
      // A query naming a company also takes the articles about it, ranked first.
      const scored = entityTag ? sql`
          SELECT p.article_id, p.timeline_at, max(matches.part) + (${titleScore}) + (CASE WHEN p.tags @> ${[entityTag]}::text[] THEN 10 ELSE 0 END) AS rel
          FROM (SELECT article_id, part FROM matches UNION ALL SELECT article_id, 0 FROM publications WHERE tags @> ${[entityTag]}::text[]) matches
          JOIN publications p ON p.article_id = matches.article_id
          WHERE ${listedCondition(now)} ${filters}
          GROUP BY p.article_id, p.timeline_at, p.title, p.tags` : sql`
          SELECT p.article_id, p.timeline_at, matches.part + (${titleScore}) AS rel
          FROM matches JOIN publications p ON p.article_id = matches.article_id JOIN sources s ON s.id = p.source_id
          WHERE ${listedCondition(now)} ${filters}`;
      return groupedPage(db, sql`WITH matches AS ${splitFields ? sql`MATERIALIZED` : sql`NOT MATERIALIZED`} (${matches}) ${scored}`);
    }
    return groupedPage(db, sql`SELECT p.article_id, 0 AS rel FROM publications p
      WHERE ${listedCondition(now)} ${filters} ${matchOrSubject(directMatchCondition(terms))}`);
  };

  const { rows, total, todayCount } = q ? await withSearchCapacity(run) : await run(sql);
  const meta = one(await sql<{ today_count: number; updated_at: Date | null }[]>`
    ${q ? sql`WITH ${eventEntries(sql`SELECT p.article_id, 0 AS rel FROM publications p WHERE ${listedCondition(now)} ${filters}`)}` : sql``}
    SELECT ${q ? sql`(SELECT count(*) FROM entries WHERE anchor_at >= ${todayStart})` : sql`${todayCount}::bigint`} AS today_count,
      (SELECT max(p.updated_at) FROM publications p WHERE p.eligible) AS updated_at`);

  const holders = await seatHolders(rows, now);
  return {
    filters: { channel: query.channel, category: query.category, tag: query.tag, q, tab },
    items: rows.map((r) => ({
      ...(holders.has(r.id) ? { ...toFeedItemSummary(r), reason: null, sameEvent: holders.get(r.id)! } : toFeedItemSummary(r)),
      anchorAt: r.anchor_at.toISOString(),
      group: r.group_public_id && r.report_count > 1 ? {
        factId: r.group_public_id, reportCount: r.report_count, additionalSourceCount: r.source_count - 1,
        ...(r.group_story_id !== null ? { scope: "story" as const, developmentCount: r.development_count } : {}),
      } : null,
    })),
    page,
    pageCount: Math.min(POOL_MAX_PAGES, Math.max(1, Math.ceil(total / POOL_PAGE_SIZE))),
    total,
    todayCount: Number(meta.today_count),
    freshness: (meta.updated_at ?? now).toISOString(),
    hot: q || query.category || query.tag ? null : await loadHotStrip(),
  };
}
