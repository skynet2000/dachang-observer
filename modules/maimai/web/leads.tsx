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
    <header className="border-b border-line pb-5 pt-5 lg:pt-2">
      <Link to="/all?category=workplace" className="hidden text-[13px] text-accent hover:underline lg:inline-flex"><Text>回到资讯</Text> →</Link>
      <h1 className="mt-3 text-[26px] font-bold tracking-tight text-ink lg:text-[32px]"><Text>职场热议线索</Text></h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-3"><Text>公开可分享的脉脉讨论，仅作线索，未经独立核实，不代表企业确认。</Text></p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-4"><Text>按本站发现时间排列，可能包含被重新讨论的旧帖；不混入新闻时间线、热点榜或刊物。帖子保留原文。</Text></p>
    </header>
    <div role="status" className="my-5 rounded-control border border-line bg-bg-sunk px-4 py-3 text-[13px] leading-relaxed text-ink-3">
      <Text>{stale ? "公开入口状态待检查，当前列表可能不是最新。" : status?.ok ? "公开入口检查正常。互动数为最近一次观察值。" : "部分公开入口读取失败，当前列表可能不完整。"}</Text>
      {status && <p className="mt-1"><Text>最近检查（北京时间）</Text> · <time dateTime={status.checkedAt}>{time(status.checkedAt)}</time></p>}
    </div>
    {items.length === 0 ? <p className="py-12 text-center text-[14px] text-ink-3"><Text>{status?.ok && !stale ? "本轮未发现符合主题与互动门槛的公开线索。" : "暂时没有可展示的线索，请稍后查看；不能据此判断当天没有职场讨论。"}</Text></p> :
      <div className="space-y-4">{items.map(item => <article key={item.id} className="rounded-sheet border border-line bg-surface p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-3"><span className="rounded-full bg-hot-soft px-2.5 py-1 text-hot"><Text>未经独立核实</Text></span><span><Text>脉脉 · 公开原帖</Text></span></div>
        <h2 className="break-words text-[18px] font-semibold leading-relaxed text-ink"><a href={item.url} target="_blank" rel="nofollow noopener noreferrer" className="hover:text-accent">{item.title}{item.title.length >= 100 ? "…" : ""}</a></h2>
        <details className="group mt-3 text-[13px] text-ink-3"><summary className="min-h-11 cursor-pointer py-3 text-accent"><span className="group-open:hidden"><Text>展开原帖摘录</Text></span><span className="hidden group-open:inline"><Text>收起原帖摘录</Text></span></summary>
          <p className="whitespace-pre-line break-words text-[14px] leading-[1.8]">{item.excerpt}</p>
        </details>
        <div className="mt-4 border-t border-line-soft pt-3 text-[12px] leading-relaxed text-ink-4">
          <p><Text>{item.publishedAt ? "原发时间（北京时间）" : "发布时间未核实"}</Text>{item.publishedAt && <> · <time dateTime={item.publishedAt}>{time(item.publishedAt)}</time></>}</p>
          <p className="mt-1"><Text>发现时间（北京时间）</Text> · <time dateTime={item.firstSeenAt}>{time(item.firstSeenAt)}</time></p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span>{item.likes} <Text>点赞</Text> · {item.comments} <Text>评论</Text></span><a href={item.url} target="_blank" rel="nofollow noopener noreferrer" className="inline-flex min-h-11 items-center text-[13px] font-medium text-accent"><Text>查看原帖</Text> ↗</a></div>
        </div>
      </article>)}</div>}
  </div>;
}
