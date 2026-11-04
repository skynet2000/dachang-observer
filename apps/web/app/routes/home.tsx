import AllPage, { loader as allLoader, meta as allMeta } from "./all";
import { EDITORIAL } from "@aihot/site";
import { Text } from "@aihot/web/lib/text";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { Timeline } from "../features/feed/Timeline";
import { FeedMasthead } from "../features/feed/FeedMasthead";
import { FeedWelcome } from "../features/feed/FeedWelcome";
import { HotTopics } from "../features/feed/HotTopics";
import { ActiveFilters, CategoryTabs, FeedBar, SearchField } from "../features/feed/Filters";
import { SectionTabTitle } from "../components/ui/Page";

export const handle = { tab: EDITORIAL.selectionEnabled ? "featured" : "all", name: EDITORIAL.selectionEnabled ? "精选" : "资讯" } satisfies Screen;
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs): Promise<Awaited<ReturnType<typeof allLoader>> | ReturnType<typeof cachedPage<{data: TimelineResponse; filters: ReturnType<typeof readFilters>}>>> {
  const url = new URL(request.url);
  if (!EDITORIAL.selectionEnabled) return allLoader({ request } as never);
  // Source channels remain an API capability; reader feeds always include every source.
  if (url.searchParams.has("channel")) {
    url.searchParams.delete("channel");
    throw redirect(url.pathname + url.search);
  }
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = readFilters(url.searchParams);
  const upstream = new Headers();
  const data = await loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal });
  return cachedPage(60, { data, filters }, upstream);
}

export function meta(args: Route.MetaArgs) {
  if (!EDITORIAL.selectionEnabled) return allMeta(args as never);
  const loaderData = args.loaderData as {data: TimelineResponse; filters: ReturnType<typeof readFilters>} | undefined;
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({ path, omitDocumentTitle: true, noindex: hasFeedFilters(loaderData?.filters), jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
}

export default function Home() {
  if (!EDITORIAL.selectionEnabled) return <AllPage />;
  const { data, filters } = useLoaderData<{data:TimelineResponse; filters:ReturnType<typeof readFilters>}>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  return (
    <div className="pb-6">
      <SectionTabTitle label={handle.name} />
      <FeedBar base="/" />
      <FeedMasthead />
      {!!data.hot?.length && inNav("/hot") && <HotTopics entries={data.hot} />}
      <CategoryTabs base="/" category={filters.category} className="mobile-category-tabs lg:hidden" />
      <div className="hidden lg:block">
        <h2 className="sr-only"><Text>{title}</Text></h2>
        <div className="feed-filter-row">
          <CategoryTabs base="/" category={filters.category} />
          <div className="ml-auto flex items-center gap-3">
            <SearchField keep={{ category: filters.category, tag: filters.tag }} />
          </div>
        </div>
      </div>

      <ActiveFilters base="/" tag={filters.tag} />

      <p className="feed-order-note"><Text>按事件最新进展排列 · 同一事件合并展示，可展开查看进展</Text></p>

      <div className="min-w-0">{data.cards.length === 0 && !hasFeedFilters(filters)
          ? <FeedWelcome />
          : <Timeline initial={data} filters={data.filters} />}
      </div>
    </div>
  );
}
