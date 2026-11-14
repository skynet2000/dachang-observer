import { sql } from "@aihot/backend/db";
import type { ServerModule } from "@aihot/backend/modules";
import { READER_CATEGORIES } from "../site.ts";

/** Collection outcomes and publication outcomes are separate evidence. */
export async function coverageSnapshot(start: Date, end: Date) {
  const [pipeline] = await sql<{ successful_runs: number; impaired_sources: number; backlog: number; unclassified_workplace: number }[]>`
    SELECT
      (SELECT count(*)::int FROM fetch_runs WHERE started_at >= ${start} AND started_at < ${end} AND status='ok') AS successful_runs,
      (SELECT count(*)::int FROM sources WHERE enabled AND participation_mode='editorial'
        AND (kind <> 'external' OR id='external-maimai-posts') AND
        (health='failing' OR last_ok_at IS NULL AND created_at < now()-interval '4 hours'
          OR last_ok_at < now()-make_interval(mins => greatest(interval_minutes*2,120)+15))) AS impaired_sources,
      (SELECT count(*)::int FROM articles WHERE processing_state IN ('new','failed')
        AND discovered_at < now()-interval '2 hours' AND discovered_at > now()-interval '2 days') AS backlog,
      (SELECT count(*)::int FROM publications WHERE eligible AND visibility='public' AND category IS NULL
        AND discovered_at >= ${start} AND discovered_at < ${end}
        AND title ~ '(招聘|校招|社招|裁员|薪酬|绩效|年终奖|欠薪)') AS unclassified_workplace
  `;
  const counts = await sql`SELECT category,count(*)::int AS n FROM publications
    WHERE eligible AND visibility='public' AND (NOT selected OR visible_after<=now())
      AND published_at >= ${start} AND published_at < ${end} GROUP BY category`;
  const sections = READER_CATEGORIES.map(section => {
    const published = counts.filter(row => (section.members as readonly string[]).includes(row.category))
      .reduce((n, row) => n + row.n, 0);
    let status = "已有合格新稿";
    if (!published) {
      if (pipeline!.backlog) status = "处理积压，暂不能判定无稿";
      else if (["jobs","workplace"].includes(section.key) && pipeline!.unclassified_workplace) status = "存在未分类职场稿，需复核";
      else if (pipeline!.impaired_sources) status = "采集覆盖不完整，暂不能判定无稿";
      else if (!pipeline!.successful_runs) status = "没有成功采集记录，暂不能判定无稿";
      else status = "采集处理未见异常，暂未发现合格新稿";
    }
    return { key: section.key, label: section.label, published, status };
  });
  return { start: start.toISOString(), end: end.toISOString(), ...pipeline, sections };
}

export default {
  name: "coverage",
  followUps: async (now: number) => {
    if (process.env.COLLECT_ENABLED !== "true") return [];
    const snapshot = await coverageSnapshot(new Date(now-86400000), new Date(now));
    const findings = snapshot.sections.filter(section => !section.published
      && section.status !== "采集处理未见异常，暂未发现合格新稿").map(section => ({
      key: `coverage.quiet.${section.key}`, level: "today" as const,
      title: `${section.label}近24小时无新稿，链路需检查`,
      impact: section.status,
      action: "核查信源成功记录、处理积压和分类结果，不能按正常空栏处理",
    }));
    if (snapshot.unclassified_workplace) findings.push({
      key: "coverage.unclassified-workplace", level: "today" as const,
      title: "职场报道存在空分类",
      impact: `${snapshot.unclassified_workplace} 篇招聘或待遇相关公开稿未归入栏目，可能造成栏目漏收`,
      action: "复核原文和模型分类，不能直接按标题批量归类",
    });
    return findings;
  },
} satisfies ServerModule;
