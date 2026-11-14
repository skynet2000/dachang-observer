import { routeViewTransition } from "@aihot/web/components/shell/transitions";
import { EDITORIAL } from "@aihot/site";
import { Text, useText } from "@aihot/web/lib/text";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IntentLink } from "../components/ui/IntentLink";
import { Link, useLoaderData, useLocation } from "react-router";
import type { Route } from "./+types/story";
import type { StoryDetail, StoryReportView } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { breadcrumbLd, pageMeta, storyLd, titled } from "../lib/seo";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { monthDay, monthDayTime, relativeTime } from "../lib/format";
import { HeatChart } from "../features/story/HeatChart";
import { sessionCache } from "../lib/session-cache";
import { isReload } from "../lib/restore";
import { Badge, SelectedBadge } from "../components/ui/Badge";
import { PillTabs } from "../components/ui/Tabs";
import { Select } from "../components/ui/Controls";
import { IconArrowLeft, IconChevronRight, IconClock, IconDoc, IconUsers } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { home: inNav("/hot") ? "hot" : "featured" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ params, request }: Route.LoaderArgs) {
  const story = await loadOr404<StoryDetail>(`/api/site/stories/${encodeURIComponent(params.publicId)}`, { signal: request.signal, merged: (id) => `/story/${id}` });
  return cachedPage(300, { story });
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("事件不存在") }, { name: "robots", content: "noindex" }];
  const s = loaderData.story;
  return pageMeta({
    title: s.title,
    description: (s.digest ?? s.summary ?? s.excerpt?.text)?.slice(0, 150) ?? `${s.sourceCount} 个报道来源 ${s.reportCount} 篇报道，完整时间线与最新进展。`,
    path: `/story/${s.publicId}`,
    image: `/og/stories/${s.publicId}.png`,
    type: "article",
    jsonLd: [
      storyLd(s),
      // Under the board only while it is a way in, as the back link.
      breadcrumbLd([{ name: SITE.name, path: "/" }, ...(inNav("/hot") ? [{ name: "热点榜", path: "/hot" }] : []), { name: s.title, path: `/story/${s.publicId}` }]),
    ],
  });
}

const STATUS = {
  active: { label: "持续更新", tone: "hot" },
  watching: { label: "观察中", tone: "amber" },
  settled: { label: "历史事件", tone: "neutral" },
} as const;

// Section anchors keep the old page's ids so shared links still land in the right place.
const SECTIONS = { overview: "event-overview", reports: "event-reports", heat: "event-heat" } as const;
type SectionKey = keyof typeof SECTIONS;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A main-column card: 17px title, 24px padding. */
function Panel({ id, title, sub, right, children, className = "" }: { id?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`card scroll-mt-[calc(var(--bar-h)+64px)] p-5 lg:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-[650] leading-[1.5] text-ink"><Text>{title}</Text></h2>
          {sub && <p className="mt-0.5 text-[12.5px] text-ink-4"><Text>{sub}</Text></p>}
        </div>
        {right && <div className="shrink-0 text-[11.5px] text-ink-4"><Text>{right}</Text></div>}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/** A rail card: 14px title, 22px padding. */
function RailCard({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 lg:p-[22px] ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-[650] text-ink"><Text>{title}</Text></h2>
        {right && <span className="num text-[11.5px] text-ink-4"><Text>{right}</Text></span>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Highlights the section nav entry whose section is under the sticky bar. */
function useActiveSection(keys: SectionKey[]): [SectionKey, (k: SectionKey) => void] {
  const [active, setActive] = useState<SectionKey>("overview");
  const clampedTarget = useRef<{ key: SectionKey; landed: boolean } | null>(null);
  useEffect(() => {
    const sections = keys.flatMap((key) => {
      const el = document.getElementById(SECTIONS[key]);
      return el ? [{ key, el }] : [];
    });
    const onScroll = () => {
      let cur: SectionKey = keys[0]!;
      // Use the same offset as anchor scrolling; fractional positions need one pixel of tolerance.
      for (const { key, el } of sections) {
        const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        if (el.getBoundingClientRect().top <= offset + 1) cur = key;
      }
      // Several short sections can share the bottom landing. A click disambiguates that landing;
      // scrolling away restores the ordinary position-based highlight.
      const bottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (bottom) {
        cur = clampedTarget.current?.key ?? keys[keys.length - 1]!;
        if (clampedTarget.current) clampedTarget.current.landed = true;
      } else if (clampedTarget.current?.landed) clampedTarget.current = null;
      setActive(cur);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const resized = new ResizeObserver(onScroll);
    resized.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      resized.disconnect();
    };
  }, [keys.join()]);
  const go = (k: SectionKey) => {
    const el = document.getElementById(SECTIONS[k]);
    if (!el) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const destination = window.scrollY + el.getBoundingClientRect().top - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
    clampedTarget.current = destination >= max - 1 ? { key: k, landed: false } : null;
    setActive(k);
    el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    history.replaceState(history.state, "", `#${SECTIONS[k]}`);
  };
  return [active, go];
}

/** One report on the story timeline: time, source and marks, title, a summary that opens on demand. */
function TimelineRow({ r }: { r: StoryReportView }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [r.summary, open]);
  return (
    <li className="grid gap-x-3 border-b border-line-soft py-4 last:border-b-0 lg:grid-cols-[48px_minmax(0,1fr)]">
      <time dateTime={r.publishedAt} className="mono text-[12px] leading-[20px] text-ink-4">
        <Text>{beijingTime(r.publishedAt)}</Text>
      </time>
      <div className="min-w-0">
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] leading-[20px] text-ink-4 lg:mt-0">
          <span className="min-w-0 truncate"><Text>{r.source.name}</Text></span>
          {r.selected && <SelectedBadge />}
        </div>
        <IntentLink viewTransition to={`/items/${r.id}`} className="mt-1 block text-[16px] font-[650] leading-[1.6] text-ink transition-colors hover:text-accent lg:text-[15.5px]">
          <Text content>{r.title}</Text>
        </IntentLink>
        {r.summary && (
          <>
            <p ref={ref} className={`mt-1 text-[14px] leading-[1.75] text-ink-3 ${open ? "" : "line-clamp-2"}`}>
              <Text content>{r.summary}</Text>
            </p>
            {(clamped || open) && (
              <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-[12.5px] text-note transition-colors hover:text-accent">
                <Text>{open ? "收起摘要" : "展开摘要"}</Text>
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

type Filter = "all" | "official" | "selected";
type Order = "desc" | "asc";

// The report filter and shared reading order, per history entry: back from a report restores the view.
const viewCache = sessionCache<{ savedAt: number; filter: Filter; order: Order }>("aihot:story-view:", 30 * 60 * 1000);

export default function StoryPage() {
  const translate = useText();
  const { story } = useLoaderData<typeof loader>();
  const entry = useLocation().key;
  const [filter, setFilter] = useState<Filter>(() => !EDITORIAL.selectionEnabled && viewCache.peek(entry)?.filter === "selected" ? "all" : viewCache.peek(entry)?.filter ?? "all");
  const [order, setOrder] = useState<Order>(() => viewCache.peek(entry)?.order ?? "desc");
  // A document the browser reloaded on back/forward gets the view back after hydration.
  useEffect(() => {
    if (viewCache.peek(entry) || isReload()) return;
    const saved = viewCache.read(entry);
    if (saved) {
      setFilter(!EDITORIAL.selectionEnabled && saved.filter === "selected" ? "all" : saved.filter);
      setOrder(saved.order);
    }
  }, [entry]);
  useEffect(() => {
    if (filter !== "all" || order !== "desc" || viewCache.peek(entry)) viewCache.set(entry, { savedAt: Date.now(), filter, order });
  }, [entry, filter, order]);
  const status = STATUS[story.status];
  // A settled story nobody watched (history pages) has no heat to explain or chart.
  const observed = story.status !== "settled" || story.heat.length > 0 || story.whyHot.participants48h > 0 || story.whyHot.rank !== null;
  const sectionKeys: SectionKey[] = observed ? ["overview", "reports", "heat"] : ["overview", "reports"];
  const [activeSection, goSection] = useActiveSection(sectionKeys);
  const counts = {
    all: story.timeline.length,
    official: story.timeline.filter((r) => r.source.firstParty).length,
    selected: story.timeline.filter((r) => r.selected).length,
  };
  const days = useMemo(() => {
    const list = story.timeline.filter((r) => (filter === "official" ? r.source.firstParty : filter === "selected" ? r.selected : true));
    const sorted = [...list].sort((a, b) => (order === "desc" ? Date.parse(b.publishedAt) - Date.parse(a.publishedAt) : Date.parse(a.publishedAt) - Date.parse(b.publishedAt)));
    const out: Array<{ day: string; rows: StoryReportView[] }> = [];
    for (const r of sorted) {
      const d = beijingDate(r.publishedAt);
      const last = out[out.length - 1];
      if (last && last.day === d) last.rows.push(r);
      else out.push({ day: d, rows: [r] });
    }
    return out;
  }, [story.timeline, filter, order]);
  const developments = useMemo(() => [...story.developments].sort((a, b) =>
    order === "desc" ? Date.parse(b.firstReportAt) - Date.parse(a.firstReportAt) : Date.parse(a.firstReportAt) - Date.parse(b.firstReportAt)
  ), [story.developments, order]);
  const newest = story.latestReport;
  const overview = story.digest
    ? { label: "AI 综述", text: story.digest, note: story.digestUpdatedAt ? `AI 根据报道生成 · ${relativeTime(story.digestUpdatedAt)}更新` : "AI 根据报道生成" }
    : story.summary
      ? { label: "事实说明", text: story.summary, note: null }
      : story.excerpt
        ? { label: "报道摘要", text: story.excerpt.text, note: `摘自 ${story.excerpt.sourceName}` }
        : null;
  const showOfficial = () => {
    setFilter("official");
    goSection("reports");
  };

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-10">
      <PhoneBar back={inNav("/hot") ? { to: "/hot", label: "热点" } : { to: "/", label: EDITORIAL.selectionEnabled ? "精选" : "资讯" }} title={translate(story.title)} />
      <nav aria-label={translate("位置")} className="hidden items-center gap-2.5 pb-5 pt-4 text-[12px] text-ink-4 lg:flex">
        <Link to={inNav("/hot") ? "/hot" : "/"} className="inline-flex items-center gap-1.5 transition-colors hover:text-ink">
          <IconArrowLeft size={15} /> <Text>{inNav("/hot") ? "热点榜" : EDITORIAL.selectionEnabled ? "精选" : "资讯"}</Text>
        </Link>
        <span className="h-3 w-px bg-line-strong" aria-hidden="true" />
        <span><Text>事件详情</Text></span>
      </nav>

      <header className="max-w-[960px] pt-3 lg:pt-0">
        <div className="flex items-center gap-2 text-[12px] text-ink-4"><Text>
          热点事件
          </Text><Badge tone={status.tone}><Text>{status.label}</Text></Badge>
        </div>
        <h1 data-page-title="" className="mt-2.5 text-[27px] font-bold leading-[1.5] tracking-[-0.01em] text-ink lg:mt-3 lg:text-[36px] lg:font-[730]"><Text content>{story.title}</Text></h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <IconDoc size={15} className="text-ink-4" />
            <b className="num font-semibold text-ink"><Text>{story.reportCount}</Text></b><Text> 篇报道
          </Text></span>
          <span className="inline-flex items-center gap-1.5">
            <IconUsers size={15} className="text-ink-4" />
            <b className="num font-semibold text-ink"><Text>{story.sourceCount}</Text></b><Text> 个报道来源
          </Text></span>
          {story.latestAt && (
            <span className="inline-flex items-center gap-1.5" suppressHydrationWarning>
              <IconClock size={15} className="text-ink-4" />
              <Text>{`${relativeTime(story.latestAt)}更新`}</Text></span>
          )}
        </div>
      </header>

      <div className="bleed sticky top-[var(--bar-h)] z-20 mt-5 bg-bg/90 py-2 backdrop-blur-md lg:mx-0 lg:px-0">
        <PillTabs
          size="sm"
          layoutId="story-sections"
          label="事件内容导航"
          active={activeSection}
          onSelect={(k) => goSection(k as SectionKey)}
          items={[
            { key: "overview", label: "事件概览" },
            { key: "reports", label: "报道时间线", count: story.reportCount },
            ...(observed ? [{ key: "heat", label: "热度走势" }] : []),
          ]}
        />
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* On phones the main column dissolves so the rail's cards can sit between its sections. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <Panel id={SECTIONS.overview} title={translate("先了解这件事")} right={overview?.label} className="order-1">
            {overview ? (
              <>
                <p className="whitespace-pre-line text-[15px] leading-[1.85] text-ink-2"><Text content>{overview.text}</Text></p>
                {overview.note && (
                  <p className="mt-2 text-[12px] text-ink-4" suppressHydrationWarning>
                    <Text>{overview.note}</Text>
                  </p>
                )}
              </>
            ) : (
              <p className="text-[13.5px] text-ink-4"><Text>还没有综述，先看下面的报道时间线。</Text></p>
            )}
            {story.latest && (
              <div className="-mx-5 mt-5 border-t border-line-soft px-5 pt-4 lg:-mx-6 lg:px-6">
                <div className="flex items-center gap-2.5 text-[12px]">
                  <span className="font-semibold text-ink"><Text>最新进展</Text></span>
                  {story.latestAt && <span className="num text-ink-4"><Text>{monthDayTime(story.latestAt)}</Text></span>}
                </div>
                {newest ? (
                  <Link viewTransition={routeViewTransition()} to={`/items/${newest.id}`} className="group mt-1.5 inline text-[14px] leading-[1.7] text-ink-2 transition-colors hover:text-accent">
                    <Text>{story.latest}</Text>
                    <IconChevronRight size={14} className="ml-0.5 inline -translate-y-px text-ink-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ) : (
                  <p className="mt-1.5 text-[14px] leading-[1.7] text-ink-2"><Text>{story.latest}</Text></p>
                )}
              </div>
            )}
          </Panel>

          {story.developments.length > 1 && (
            <Panel title={translate("事件进展")} sub={`${story.developments.length} 个进展`} className="order-3" right={
              <Select value={order} onChange={(e) => setOrder(e.target.value as "desc" | "asc")} aria-label={translate("事件进展排序")}>
                <option value="desc"><Text>最新在前</Text></option>
                <option value="asc"><Text>最早在前</Text></option>
              </Select>
            }>
              <ol className="relative space-y-4 pl-5 before:absolute before:bottom-2 before:left-[3px] before:top-2 before:w-px before:bg-line">
                {developments.map((d) => (
                  <li key={d.factId} className="relative">
                    <span className={`absolute -left-5 top-[7px] size-[7px] rounded-full ring-4 ring-surface ${d.factId === story.developments[0]?.factId ? "bg-accent" : "bg-line-strong"}`} aria-hidden="true" />
                    <div className="num text-[12px] text-ink-4">
                      <Text>{monthDayTime(d.firstReportAt)}</Text> · <Text>{d.reportCount}</Text><Text> 篇报道
                    </Text></div>
                    <Link viewTransition={routeViewTransition()} to={`/items/${d.representative.id}`} className="mt-0.5 block text-[15px] font-semibold leading-snug text-ink transition-colors hover:text-accent">
                      <Text content>{d.title}</Text>
                    </Link>
                    <div className="mt-0.5 truncate text-[12.5px] text-ink-4">
                      <Text>{d.representative.source.name}</Text>：<Text content>{d.representative.title}</Text>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel
            id={SECTIONS.reports}
            title={translate("报道时间线")}
            sub="沿着报道，了解事件的不同侧面。"
            className="order-4"
            right={
              <Select value={order} onChange={(e) => setOrder(e.target.value as "desc" | "asc")} aria-label={translate("报道时间线排序")}>
                <option value="desc"><Text>最新在前</Text></option>
                <option value="asc"><Text>最早在前</Text></option>
              </Select>
            }
          >
            <PillTabs
              size="xs"
              layoutId="story-report-filter"
              label="报道筛选"
              active={filter}
              onSelect={(k) => setFilter(k as Filter)}
              items={[
                { key: "all", label: "全部报道", count: counts.all },
                { key: "official", label: "官方一手", count: counts.official },
                ...(EDITORIAL.selectionEnabled ? [{ key: "selected", label: "精选报道", count: counts.selected }] : []),
              ]}
            />
            {days.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-ink-4"><Text>这个筛选下没有报道。</Text></p>
            ) : (
              days.map(({ day, rows }) => (
                <div key={day}>
                  <div className="pb-0.5 pt-5 text-[14px] font-semibold text-ink"><Text>{monthDay(day)}</Text></div>
                  <ol>
                    {rows.map((r) => (
                      <TimelineRow key={r.id} r={r} />
                    ))}
                  </ol>
                </div>
              ))
            )}
            {story.reportCount > story.timeline.length && (
              <p className="pt-3 text-center text-[12px] text-ink-4"><Text>
                显示最近 </Text><Text>{story.timeline.length}</Text><Text> 篇，共 </Text><Text>{story.reportCount}</Text><Text> 篇报道。
              </Text></p>
            )}
          </Panel>

          {observed && (
            <Panel id={SECTIONS.heat} title={translate("本事件热度走势")} className="order-5">
              <HeatChart points={story.heat} />
            </Panel>
          )}

          {story.related.length > 0 && (
            <Panel title={translate("关联事件")} className="order-6">
              <ul className="-my-1 divide-y divide-line-soft">
                {story.related.map((r) => (
                  <li key={r.publicId}>
                    <Link viewTransition={routeViewTransition()} to={`/story/${r.publicId}`} className="group flex items-baseline gap-3 py-3">
                      <span className="shrink-0 text-[12px] text-ink-4"><Text>{r.relation === "storyline" ? "同一故事线" : "相关事件"}</Text></span>
                      <span className="min-w-0 flex-1 text-[14.5px] font-medium text-ink-2 transition-colors group-hover:text-accent"><Text content>{r.title}</Text></span>
                      <IconChevronRight size={14} className="shrink-0 self-center text-ink-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className="order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:gap-5">
          {observed && (
            <RailCard title={translate("为什么热")}>
              <p className="text-[12.5px] leading-[1.75] text-ink-3"><Text>
                过去 48 小时，已观察到 </Text><b className="num font-semibold text-ink"><Text>{story.whyHot.participants48h}</Text></b><Text> 个独立主体参与讨论或报道，最近 6 小时新增</Text><Text>{" "}</Text>
                <b className="num font-semibold text-ink"><Text>{story.whyHot.newParticipants6h}</Text></b><Text> 个。
              </Text></p>
              {!story.whyHot.observationComplete && <p className="mt-2 text-[12px] leading-relaxed text-ink-4"><Text>部分信源观测不完整，以上仅为已观察到的参与。</Text></p>}
              <p className="mt-2 text-[12px] text-ink-4">
                <span className="num"><Text>{story.whyHot.recentReports24h}</Text></span><Text> 篇近期报道
                </Text>{story.whyHot.rank && inNav("/hot") && (
                  <>
                    <span className="mx-1">·</span>
                    <Link to="/hot" className="text-accent hover:underline"><Text>
                      热点榜第 </Text><Text>{story.whyHot.rank}</Text><Text> 名
                    </Text></Link>
                  </>
                )}
              </p>
            </RailCard>
          )}
          {story.officialReports.length > 0 && (
            <RailCard title={translate("官方一手")} right={`${counts.official || story.officialReports.length} 篇`}>
              <p className="text-[12px] text-ink-4"><Text>直接了解当事方的说法</Text></p>
              <ul className="mt-1 divide-y divide-line-soft">
                {story.officialReports.slice(0, 5).map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="truncate text-[11.5px] text-ink-4"><Text>{r.source.name}</Text></div>
                    <Link viewTransition={routeViewTransition()} to={`/items/${r.id}`} className="group mt-1 block text-[13.5px] font-semibold leading-[1.6] text-ink transition-colors hover:text-accent">
                      <Text content>{r.title}</Text>
                      <IconChevronRight size={13} className="ml-0.5 inline -translate-y-px text-ink-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
              {counts.official > 0 && (
                <button type="button" onClick={showOfficial} className="text-[12px] text-ink-4 transition-colors hover:text-accent"><Text>
                  在时间线筛选全部官方报道
                </Text></button>
              )}
            </RailCard>
          )}
          {story.topics.length > 0 && (
            <RailCard title={translate("相关主题")}>
              <div className="flex flex-wrap gap-1.5">
                {story.topics.map((t) => (
                  <Link viewTransition={routeViewTransition()} key={t.slug} to={`/topics/${t.slug}`} className="chip">
                    <Text>{t.name}</Text>
                  </Link>
                ))}
              </div>
            </RailCard>
          )}
          <RailCard title={translate("事件记录")} className="hidden lg:block">
            <dl className="space-y-2 text-[12.5px]">
              {story.firstReportAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-4"><Text>最早报道</Text></dt>
                  <dd className="num text-ink-2">
                    <time dateTime={story.firstReportAt}><Text>{monthDayTime(story.firstReportAt)}</Text></time>
                  </dd>
                </div>
              )}
              {story.latestAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-4"><Text>最近更新</Text></dt>
                  <dd className="num text-ink-2">
                    <time dateTime={story.latestAt}><Text>{monthDayTime(story.latestAt)}</Text></time>
                  </dd>
                </div>
              )}
            </dl>
            <p className="mt-3 border-t border-line-soft pt-3 text-[12px] leading-relaxed text-ink-4"><Text>同一事件的报道集中在这里，新的进展会继续补充。</Text></p>
          </RailCard>
        </aside>
      </div>
    </div>
  );
}
