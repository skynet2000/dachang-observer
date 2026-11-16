import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Text } from "@aihot/web/lib/text";
import { cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageMeta } from "@aihot/web/lib/seo";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { beijingDate, beijingTime } from "@aihot/contracts/time";

type Lead = { id: string; url: string; title: string; excerpt: string; likes: number; comments: number;
  publishedAt: string | null; firstSeenAt: string; lastSeenAt: string };
type Leads = { status: { ok: boolean; checkedAt: string } | null; items: Lead[] };

export const handle = { tab: "all", name: "职场热议线索" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const meta = () => pageMeta({ title: "职场热议线索", path: "/workplace-leads", noindex: true });
export async function loader({ request }: LoaderFunctionArgs) {
  return cachedPage(60, await loadOr404<Leads>("/api/maimai/leads", { signal: request.signal }));
}
const time = (at: string) => `${beijingDate(at)} ${beijingTime(at)}`;

export default function WorkplaceLeads() {
  const { items, status } = useLoaderData<typeof loader>();
  const stale = !status || Date.now() - new Date(status.checkedAt).getTime() > 90 * 60000;
  return <div className="mx-auto max-w-[900px] pb-8">
    <PhoneBar title="职场热议线索" back={{ to: "/all?category=workplace", label: "资讯" }} />
    <header className="pb-4 pt-5 lg:pt-2">
      <Link to="/all?category=workplace" className="hidden text-[13px] text-accent hover:underline lg:inline-flex">← <Text>回到资讯</Text></Link>
      <p className="mb-2 text-[11px] font-semibold tracking-[.12em] text-accent lg:mt-5"><Text>脉脉 · 公开原帖</Text></p>
      <h1 className="text-[26px] font-bold tracking-tight text-ink lg:text-[32px]"><Text>职场热议线索</Text></h1>
      <p className="mt-2 text-[13px] leading-[1.7] text-ink-3"><Text>公开可分享的脉脉讨论，仅作线索，未经独立核实，不代表企业确认。</Text></p>
    </header>
    <div className="mb-4 border-l-2 border-accent bg-accent-softer px-3 py-2 text-[12px] leading-[1.7] text-ink-3"><Text>按发现时间排列，可能包含旧帖；不计入新闻时间线与热点榜。</Text></div>
    <div role="status" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line pb-3 text-[12px] leading-relaxed text-ink-4">
      <span className={`size-1.5 shrink-0 rounded-full ${stale || !status?.ok ? "bg-hot" : "bg-accent"}`} aria-hidden="true" />
      <Text>{stale ? "公开入口状态待检查，当前列表可能不是最新。" : status?.ok ? "公开入口检查正常。互动数为最近一次观察值。" : "部分公开入口读取失败，当前列表可能不完整。"}</Text>
      {status && <span className="text-ink-4"><Text>最近检查（北京时间）</Text> · <time dateTime={status.checkedAt}>{time(status.checkedAt)}</time></span>}
    </div>
    {items.length === 0 ? <p className="py-12 text-center text-[14px] text-ink-3"><Text>{status?.ok && !stale ? "本轮未发现符合主题与互动门槛的公开线索。" : "暂时没有可展示的线索，请稍后查看；不能据此判断当天没有职场讨论。"}</Text></p> :
      <div className="border-t border-line">{items.map(item => <article key={item.id} className="border-b border-line px-0 py-5 lg:px-3 lg:py-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-4"><span><Text>脉脉 · 公开原帖</Text></span><span aria-hidden="true">·</span><span className="font-medium text-hot"><Text>未经独立核实</Text></span></div>
        <h2 className="line-clamp-3 break-words text-[17px] font-semibold leading-[1.55] text-ink lg:text-[19px]"><a href={item.url} target="_blank" rel="nofollow noopener noreferrer" className="hover:text-accent">{item.title}{item.title.length >= 100 ? "…" : ""}</a></h2>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-relaxed text-ink-4">
          <span><Text>{item.publishedAt ? "原发时间（北京时间）" : "发布时间未核实"}</Text>{item.publishedAt && <> · <time dateTime={item.publishedAt}>{time(item.publishedAt)}</time></>}</span>
          <span><Text>发现时间（北京时间）</Text> · <time dateTime={item.firstSeenAt}>{time(item.firstSeenAt)}</time></span>
        </div>
        <details className="group mt-2 text-[13px] text-ink-3"><summary className="inline-flex min-h-11 cursor-pointer items-center text-accent"><span className="group-open:hidden"><Text>展开原帖摘录</Text></span><span className="hidden group-open:inline"><Text>收起原帖摘录</Text></span></summary>
          <p className="whitespace-pre-line break-words pb-2 text-[14px] leading-[1.8]">{item.excerpt}</p>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-[12px] text-ink-4"><span>{item.likes} <Text>点赞</Text> · {item.comments} <Text>评论</Text></span><a href={item.url} target="_blank" rel="nofollow noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-medium text-accent hover:underline"><Text>查看原帖</Text> ↗</a></div>
      </article>)}</div>}
  </div>;
}
