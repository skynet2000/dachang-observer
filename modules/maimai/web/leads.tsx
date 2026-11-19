import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Text, useText } from "@aihot/web/lib/text";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { PillTabs } from "@aihot/web/components/ui/Tabs";
import { Pagination } from "@aihot/web/features/feed/DayList";
import { beijingDate, beijingTime } from "@aihot/contracts/time";

type Lead = { id: string; url: string; topicUrl?: string; title: string; excerpt: string; likes: number; comments: number;
  publishedAt: string | null; firstSeenAt: string; lastSeenAt: string };
type Leads = { status: { ok: boolean; checkedAt: string } | null; items: Lead[]; page?: number; pageCount?: number };

const leadsPath = "/workplace-leads";
const historyQuery = (page = 1) => `?view=history${page > 1 ? `&page=${page}` : ""}`;

export const handle = { tab: "all", name: "职场热议" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const meta = () => pageMeta({ title: "职场热议", path: leadsPath, noindex: true });
export async function loader({ request }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const history = query.get("view") === "history";
  const requestedPage = Number(query.get("page") ?? 1);
  const suffix = history ? historyQuery(Number.isSafeInteger(requestedPage) ? requestedPage : 1) : "";
  const data = await loadOr404<Leads>(`/api/maimai/leads${suffix}`, { signal: request.signal });
  return cachedPage(60, { ...data, history });
}
const time = (at: string) => `${beijingDate(at)} ${beijingTime(at)}`;
const heat = (item: Lead) => item.likes + item.comments * 2;

function groupByTopic(items: Lead[]) {
  const groups = new Map<string, Lead[]>();
  for (const item of items) {
    const key = item.topicUrl || item.url;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => [...group].sort((a, b) => heat(b) - heat(a)));
}

export default function WorkplaceLeads() {
  const { items, status, history, page = 1, pageCount = 1 } = useLoaderData<typeof loader>();
  const translate = useText();
  const stale = !status || Date.now() - new Date(status.checkedAt).getTime() > 90 * 60000;
  const groups = groupByTopic(items);
  return <div className="mx-auto max-w-[900px] pb-8">
    <PhoneBar title="职场热议" back={{ to: "/all?category=workplace", label: "资讯" }} />
    <header className="pb-4 pt-5 lg:pt-2">
      <Link to="/all?category=workplace" className="hidden text-[13px] text-accent hover:underline lg:inline-flex">← <Text>回到资讯</Text></Link>
      <p className="mb-2 text-[11px] font-semibold tracking-[.12em] text-accent lg:mt-5"><Text>脉脉 · 公开讨论帖</Text></p>
      <h1 className="text-[26px] font-bold tracking-tight text-ink lg:text-[32px]"><Text>职场热议</Text></h1>
      <p className="mt-2 text-[13px] leading-[1.7] text-ink-3"><Text>公开可分享的脉脉讨论帖，仅作线索；可能是转述或个人观点，未经独立核实，不代表企业确认。</Text></p>
    </header>
    <PillTabs items={[{ key: "recent", label: "近期", to: leadsPath },
      { key: "history", label: "近 30 天", to: leadsPath + historyQuery() }]}
      active={history ? "history" : "recent"} layoutId="workplace-leads-view" label="职场热议时间范围" size="sm" className="mb-3" />
    <div className="mb-4 border-l-2 border-accent bg-accent-softer px-3 py-2 text-[12px] leading-[1.7] text-ink-3"><Text>{history ? "展示近 30 天发现的讨论，互动数为最后一次观察值。" : "按话题最近发现时间排列；同话题优先展示互动较高的帖子，其余可展开。可能包含旧帖，不计入新闻时间线与热点榜。"}</Text></div>
    {!history && <div role="status" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line pb-3 text-[12px] leading-relaxed text-ink-4">
      <span className={`size-1.5 shrink-0 rounded-full ${stale || !status?.ok ? "bg-hot" : "bg-accent"}`} aria-hidden="true" />
      <Text>{stale ? "公开入口状态待检查，当前列表可能不是最新。" : status?.ok ? "公开入口检查正常。互动数为最近一次观察值。" : "部分公开入口读取失败，当前列表可能不完整。"}</Text>
      {status && <span className="text-ink-4"><Text>最近检查（北京时间）</Text> · <time dateTime={status.checkedAt}>{time(status.checkedAt)}</time></span>}
    </div>}
    {items.length === 0 ? <p className="py-12 text-center text-[14px] text-ink-3"><Text>{history ? "近 30 天暂无存档讨论。" : status?.ok && !stale ? "本轮未发现符合主题与互动门槛的公开线索。" : "暂时没有可展示的线索，请稍后查看；不能据此判断当天没有职场讨论。"}</Text></p> :
      <div className="border-t border-line">{groups.map(group => { const item = group[0]!; const newest = group.reduce((a, b) => a.firstSeenAt > b.firstSeenAt ? a : b); return <article key={item.topicUrl || item.url} className="border-b border-line px-0 py-5 lg:px-3 lg:py-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-4"><span><Text>脉脉 · 公开讨论帖</Text></span><span aria-hidden="true">·</span><span className="font-medium text-hot"><Text>未经独立核实</Text></span></div>
        <h2 className="line-clamp-3 break-words text-[17px] font-semibold leading-[1.55] text-ink lg:text-[19px]"><a href={item.url} target="_blank" rel="nofollow noopener noreferrer" className="hover:text-accent">{item.title}{item.title.length >= 100 ? "…" : ""}</a></h2>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-relaxed text-ink-4">
          <span><Text>{item.publishedAt ? "原发时间（北京时间）" : "发布时间未核实"}</Text>{item.publishedAt && <> · <time dateTime={item.publishedAt}>{time(item.publishedAt)}</time></>}</span>
          <span><Text>发现时间（北京时间）</Text> · <time dateTime={item.firstSeenAt}>{time(item.firstSeenAt)}</time></span>
          {item.id !== newest.id && <span><Text>话题最近发现（北京时间）</Text> · <time dateTime={newest.firstSeenAt}>{time(newest.firstSeenAt)}</time></span>}
        </div>
        <details className="group mt-2 text-[13px] text-ink-3"><summary className="inline-flex min-h-11 cursor-pointer items-center text-accent"><span className="group-open:hidden"><Text>展开原帖摘录</Text></span><span className="hidden group-open:inline"><Text>收起原帖摘录</Text></span></summary>
          <p className="whitespace-pre-line break-words pb-2 text-[14px] leading-[1.8]">{item.excerpt}</p>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-[12px] text-ink-4"><span>{item.likes} <Text>点赞</Text> · {item.comments} <Text>评论</Text></span><a href={item.url} target="_blank" rel="nofollow noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-medium text-accent hover:underline"><Text>查看原帖</Text> ↗</a></div>
        {group.length > 1 && <details className="mt-3 border-t border-line text-[13px] text-ink-3"><summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-accent">{translate("同话题另有 {count} 条讨论").replace("{count}", String(group.length - 1))}</summary>
          <ul className="space-y-3 pb-2">{group.slice(1).map(other => <li key={other.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <a href={other.url} target="_blank" rel="nofollow noopener noreferrer" className="min-w-0 flex-1 break-words leading-[1.6] text-ink hover:text-accent">{other.title}</a>
            <span className="shrink-0 text-[12px] text-ink-4">{other.likes} <Text>点赞</Text> · {other.comments} <Text>评论</Text></span>
            {history && <div className="flex w-full flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-4">
              <span><Text>{other.publishedAt ? "原发时间（北京时间）" : "发布时间未核实"}</Text>{other.publishedAt && <> · <time dateTime={other.publishedAt}>{time(other.publishedAt)}</time></>}</span>
              <span><Text>发现时间（北京时间）</Text> · <time dateTime={other.firstSeenAt}>{time(other.firstSeenAt)}</time></span>
            </div>}
          </li>)}</ul>
        </details>}
      </article>; })}</div>}
    {history && <Pagination page={page} pageCount={pageCount} href={p => leadsPath + historyQuery(p)} />}
  </div>;
}
