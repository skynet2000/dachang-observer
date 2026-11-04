import { Text, useText } from "@aihot/web/lib/text";
import { useEffect } from "react";
import { Link, redirect, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/all";
import type { PoolResponse } from "@aihot/contracts/site";
import { EDITORIAL, SITE, subjectAfter } from "@aihot/site";
import { beijingTime } from "@aihot/contracts/time";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import { ActiveFilters, CategoryTabs, FeedBar, FilterRecovery, SearchField } from "../features/feed/Filters";
import { PillTabs } from "../components/ui/Tabs";
import { HotTopics } from "../features/feed/HotTopics";
import { FeedMasthead } from "../features/feed/FeedMasthead";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState, SectionTabTitle } from "../components/ui/Page";
import { IconSearch } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import { isPhone, type Screen } from "../components/shell/screens";
import { openSearch } from "../features/search/SearchOverlay";
import { addRecentSearch } from "../lib/local-state";

export const handle = { tab: "all", name: "资讯" } satisfies Screen;
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

const ALL_TITLE = subjectAfter("全部", "动态");

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Source channels remain an API capability; reader feeds always include every source.
  if (url.searchParams.has("channel")) {
    url.searchParams.delete("channel");
    throw redirect(url.pathname + url.search);
  }
  const q = url.searchParams.get("q")?.trim().slice(0, 200) || null;
  const tab = url.searchParams.get("tab") === "relevance" ? "relevance" : null;
  // Older deep-paging parameters (deep, anchorAt) still open a normal page.
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 50);
  const upstream = new Headers();
  const data = await loadOr404<PoolResponse>(
    listPath("/api/site/pool", { ...filterParams(readFilters(url.searchParams)), q, tab, page: page > 1 ? page : null }),
    // The busy page keeps the search, so it can be tried again as it was.
    { responseHeaders: upstream, signal: request.signal, busyRedirect: q ? `/all/search-busy${url.search}` : undefined },
  );
  // Past the last page of what there is: the last page, with the same search and filters.
  if (data.total > 0 && data.page > data.pageCount) throw redirect(pageHref(url.searchParams, data.pageCount));
  return cachedPage(60, { data }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.data.filters;
  const q = f?.q;
  const page = loaderData?.data.page ?? 1;
  const path = listPath("/all", { ...(f && filterParams(f)), q, tab: q && f?.tab === "relevance" ? "relevance" : null, page: page > 1 ? page : null });
  const title = `${q ? `搜索：${q}` : ALL_TITLE}${page > 1 ? ` · 第 ${page} 页` : ""}`;
  const noindex = !!q || hasFeedFilters(f);
  return pageMeta({
    title,
    omitDocumentTitle: !q && page === 1,
    description: `${SITE.name} 收录的${subjectAfter("全部", "相关动态")}，可按栏目与标签筛选，支持中英文搜索。`,
    path,
    noindex,
    jsonLd: noindex ? undefined : [
      ...(!EDITORIAL.selectionEnabled && path === "/all" ? siteLd() : []),
      itemListLd(path, title, loaderData?.data.items.map((i) => i.title) ?? []),
    ],
  });
}

function pageHref(params: URLSearchParams, page: number) {
  const sp = new URLSearchParams(params);
  sp.delete("deep");
  sp.delete("anchorAt");
  sp.delete("search");
  if (page <= 1) sp.delete("page");
  else sp.set("page", String(page));
  const s = sp.toString();
  return s ? `/all?${s}` : "/all";
}

export default function AllPage() {
  const translate = useText();
  const { data } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const f = data.filters;
  const busy = navigation.state === "loading" && navigation.location?.pathname === "/all";
  const { category } = filterParams(f);
  const keep = { category, tag: f.tag, tab: f.q && f.tab === "relevance" ? "relevance" : null };
  const searchTabHref = (tab: "time" | "relevance") => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    if (tab === "relevance") sp.set("tab", "relevance");
    else sp.delete("tab");
    return `/all?${sp}`;
  };
  const title = f.q ? `搜索“${f.q}”` : f.tag ? `#${f.tag}` : null;
  const updated = beijingTime(data.freshness);
  // Searches are remembered in this browser for the phone search (listed in the privacy notice).
  useEffect(() => {
    if (f.q) addRecentSearch(f.q);
  }, [f.q]);
  // Older phone links (/all?search=1) opened the search field; they open the search now.
  useEffect(() => {
    if (params.get("search") === "1" && isPhone()) openSearch(f.q ?? "");
  }, []);

  return (
    <div className="pb-6">
      {!f.q && data.page === 1 && <SectionTabTitle label={handle.name} />}
      {/* Phones: the feed bar, or for a search the query (tap to change it) and back to 全部. */}
      {f.q ? (
        <PhoneBar
          back={{ to: "/all", label: "资讯" }}
          center={
            <button type="button" onClick={(event) => openSearch(f.q ?? "", event.currentTarget)} className="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full bg-bg-sunk px-3.5 text-[15px] text-ink ring-1 ring-inset ring-line-soft dark:bg-bg-muted/60">
              <IconSearch size={16} className="shrink-0 text-ink-4" />
              <span className="truncate"><Text>{f.q}</Text></span>
            </button>
          }
        />
      ) : (
        <FeedBar base="/all" />
      )}
      <CategoryTabs base="/all" category={f.category} className="mobile-category-tabs lg:hidden" />

      {!f.q && !f.tag && <FeedMasthead all />}
      {!!data.hot?.length && <HotTopics entries={data.hot} />}

      {/* Desktop, as on 精选: the title, then one filter row with the search field aligned on the right. */}
      <div className="hidden lg:block">
        <h1 className={title ? "text-[24px] font-semibold leading-[1.3] text-ink" : "sr-only"}><Text>{title ?? ALL_TITLE}</Text></h1>
        <div className="feed-filter-row">
          <CategoryTabs base="/all" category={f.category} />
          <div className="ml-auto flex items-center gap-3">
            <SearchField defaultValue={f.q ?? ""} keep={keep} />
          </div>
        </div>
      </div>

      <ActiveFilters base="/all" tag={f.tag} />

      <p className="feed-order-note"><Text>{f.q && f.tab === "relevance" ? "按全文相关程度排列 · 同一事件合并展示，可展开查看进展" : "按事件最新进展排列 · 同一事件合并展示，可展开查看进展"}</Text></p>

      {f.q && (
        <div className="mb-3 mt-1 flex flex-wrap items-center justify-between gap-2 lg:mt-0">
          <PillTabs
            size="xs"
            layoutId="all-search-sort"
            label="搜索排序"
            active={f.tab}
            items={(["time", "relevance"] as const).map((t) => ({ key: t, label: t === "time" ? "最新（标题与摘要）" : "全文相关", to: searchTabHref(t) }))}
          />
          <span className="text-[12px] text-ink-4"><Text>
            找到 </Text><span className="num"><Text>{data.total >= 2000 ? "2000+" : data.total}</Text></span><Text> 条 · 更新于 </Text><span className="num"><Text>{updated}</Text></span>
          </span>
        </div>
      )}

      <div className={`transition-opacity duration-200 ${busy ? "opacity-50" : ""}`}>
        {data.items.length === 0 ? (
          <div className="mt-2 lg:card">
            <EmptyState
              title={translate("没有找到相关内容")}
              action={
                <div className="flex flex-col items-center gap-2">
                {f.q && f.tab === "time" && (
                  <Link to={searchTabHref("relevance")} className="text-[13px] font-medium text-accent hover:underline"><Text>
                    试试“全文相关”，连正文一起搜
                  </Text></Link>
                )}
                <FilterRecovery base="/all" />
                </div>
              }
            >
              <Text>{f.q ? "换个说法，或者去掉筛选再试。" : "这个筛选下暂时没有内容。"}</Text>
            </EmptyState>
          </div>
        ) : (
          <DayList items={data.items} filters={f} todayCount={f.q ? null : data.todayCount} />
        )}
      </div>
      <Pagination page={data.page} pageCount={data.pageCount} href={(p) => pageHref(params, p)} />
      {data.page >= 50 && <p className="mt-4 text-center text-[12px] text-ink-4"><Text>最多提供 50 页，更早的内容请使用搜索或主题页。</Text></p>}
    </div>
  );
}
