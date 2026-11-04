import { Text, useText } from "@aihot/web/lib/text";
import { useLoaderData } from "react-router";
import type { HotEntryView, HotResponse } from "@aihot/contracts/site";
import { withSubject } from "@aihot/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { monthDayTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { EmptyState, SectionTabTitle } from "../components/ui/Page";
import { IconChevronDown, IconInfo } from "../components/icons";
import { RankList } from "../features/hot/RankList";
import { PhoneBar } from "../components/shell/PhoneBar";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";

export const handle = { tab: inNav("/hot") ? "hot" : "featured", name: "热点" } satisfies Screen;
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  return cachedPage(120, { hot: await loadOr404<HotResponse>("/api/site/hot", { signal: request.signal }) });
}

export function meta() {
  return pageMeta({
    title: withSubject("热点榜"),
    omitDocumentTitle: true,
    description: "过去 48 小时已收录信源中的热点事件：热度指数、趋势与组成热度的公开来源。",
    path: "/hot",
    image: "/og/pages/hot.png",
  });
}

const BADGES: Record<HotEntryView["badges"][number], { label: string; tone: "hot" | "accent" | "amber"; hint: string }> = {
  surge: { label: "爆", tone: "hot", hint: "讨论快速增加" },
  new: { label: "新", tone: "accent", hint: "首报 6 小时内" },
  rising: { label: "发酵中", tone: "amber", hint: "讨论仍在增加" },
};

/** Opens "热度是怎么算的" at the foot of the page and brings it into view. */
function showMethod() {
  const method = document.getElementById("hot-method") as HTMLDetailsElement | null;
  if (!method) return;
  method.open = true;
  method.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}

export default function HotPage() {
  const translate = useText();
  const { hot } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <SectionTabTitle label={handle.name} />
      <PhoneBar
        title={translate("热点")}
        large
        sub={
          <>
            <Text>{`过去 ${hot.windowHours} 小时 · 已收录信源中的 ${hot.entries.length} 个热点`}</Text>
            {hot.computedAt && <span className="mt-1 block"><Text>更新于</Text>{" "}<Text>{monthDayTime(hot.computedAt)}</Text></span>}
          </>
        }
        actions={
          <button type="button" onClick={showMethod} className="flex h-11 items-center gap-1 px-3 text-[14px] text-accent active:opacity-50">
            <IconInfo size={17} /><Text> 怎么算
          </Text></button>
        }
      />
      <header className="hidden flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5 pt-1 lg:flex">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-hot">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-30" />
              <span className="relative inline-flex size-2 rounded-full bg-hot" />
            </span><Text>
            讨论热度
          </Text></div>
          <h1 className="mt-1.5 text-[24px] font-bold leading-[1.3] tracking-[-0.01em] text-ink lg:text-[26px]"><Text>{withSubject("热点榜")}</Text></h1>
          <p className="mt-1.5 text-[13.5px] text-ink-3"><Text>{`过去 ${hot.windowHours} 小时 · 已收录信源中的 ${hot.entries.length} 个热点`}</Text></p>
        </div>
        {hot.computedAt && (
          <p className="text-[12px] text-ink-4">
            <Text>更新于</Text>{" "}<span className="num"><Text>{monthDayTime(hot.computedAt)}</Text></span></p>
        )}
      </header>

      {hot.entries.length === 0 ? (
        <div className="card rounded-sheet">
          <EmptyState title={translate("暂时没有热点")}><Text>还没有足够多来源共同讨论的事件。</Text></EmptyState>
        </div>
      ) : (
        <section className="hot-board">
          <div className="hot-board-heading" aria-hidden="true"><span><Text>热点榜</Text></span><span><Text>热度指数</Text></span></div>
          <RankList label="热点榜" entries={hot.entries.map(e => ({
            rank: e.rank, title: e.story.title, heat: e.heat, trend: e.trend,
            storyPublicId: e.story.publicId, itemId: null, badges: e.badges,
          }))} />
        </section>
      )}

      <details id="hot-method" className="disclosure group/method mt-8 scroll-mt-[calc(var(--bar-h)+16px)] text-[12px] text-ink-4">
        <summary className="flex items-center gap-1.5 py-1 transition-colors hover:text-ink-2">
          <IconInfo size={15} /><Text>
          热度是怎么算的？
          </Text><span className="ml-auto inline-flex items-center gap-0.5">
            <span className="group-open/method:hidden"><Text>了解榜单</Text></span>
            <span className="hidden group-open/method:inline"><Text>收起</Text></span>
            <IconChevronDown size={13} className="transition-transform duration-200 group-open/method:rotate-180" />
          </span>
        </summary>
        <div className="max-w-[760px] space-y-2 pb-2 pl-[21px] pt-2 leading-[1.75] text-ink-3">
          <p><Text>热度来自参与同一事件的独立账号与机构，重复采集只算一次，并按 24 小时半衰期衰减。它衡量讨论活跃程度，不是报道质量评分。</Text></p>
          <p><Text>榜单统计过去 48 小时。趋势只比较持续覆盖的同一组信源；它反映我们的监测范围，不代表全网人数。缺少可比历史时，不展示趋势线。</Text></p>
          <p><Text>
            信源名单只展示可公开阅读的报道来源；讨论参与者还包括只计入热度的账号与机构。同一机构的多个渠道可能合并计数，因此参与者不一定多于信源数。点击事件可查看各方报道与观点。
          </Text></p>
          <dl className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
            {Object.values(BADGES).map((b) => (
              <div key={b.label} className="flex items-center gap-1.5">
                <dt>
                  <Badge tone={b.tone}><Text>{b.label}</Text></Badge>
                </dt>
                <dd><Text>{b.hint}</Text></dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </div>
  );
}
