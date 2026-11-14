import { routeViewTransition } from "@aihot/web/components/shell/transitions";
import { Text, useText } from "@aihot/web/lib/text";
import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { IntentLink } from "../components/ui/IntentLink";
import { Link, useLoaderData } from "react-router";
import type { SiteContact, SiteStats } from "@aihot/contracts/site";
import { ABOUT, EDITORIAL, POLICY, REPORTS, SITE, subjectAfter } from "@aihot/site";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { organizationLd, pageMeta } from "../lib/seo";
import { Kicker } from "../components/ui/Kicker";
import { buttonClass } from "../components/ui/Controls";
import { IconArrowRight } from "../components/icons";
import { SignalRiver, type RiverSource } from "../features/about/SignalRiver";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "me", name: "关于" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const [contact, stats] = await Promise.all([
    apiGet<SiteContact>("/api/site/contact", { signal: request.signal }).catch(() => null),
    apiGet<SiteStats>("/api/site/stats", { signal: request.signal }).catch(() => null),
  ]);
  return cachedPage(300, { contact, stats });
}

export function meta() {
  return pageMeta({ title: "关于", description: ABOUT.description, path: "/about", image: "/og/pages/about.png", jsonLd: organizationLd() });
}

const NO_SOURCES: RiverSource[] = [];

/** 3.6 万 from ten thousand up, digits with separators below. */
function figure(n: number): { value: string; unit: string } {
  return n >= 10_000 ? { value: (n / 10_000).toFixed(1).replace(/\.0$/, ""), unit: "万" } : { value: n.toLocaleString("en-US"), unit: "" };
}

function Figure({ n, unit }: { n: number; unit: string }) {
  const f = figure(n);
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="num text-[30px] font-black leading-none tracking-[-0.03em] text-ink xl:text-[36px]"><Text>{f.value}</Text></span>
      <span className="text-[13px] text-ink-3">
        <Text>{f.unit}</Text>
        <Text>{unit}</Text>
      </span>
    </div>
  );
}

const KIND_ORDER: Array<[string, string]> = [
  ["x_search", "X"],
  ["rss", "RSS"],
  ["web_list", "网页"],
  ["mp_account", "公众号"],
  ["json_list", "接口"],
];

/**
 * The stage columns' rules: one column on phones, two by two from sm, and from lg four in a row whose
 * edges fall on the river's stage boundaries.
 */
const STAGE_CELL = [
  "sm:pr-6 lg:pr-6",
  "border-t sm:border-l sm:border-t-0 sm:pl-6 lg:px-6",
  "border-t sm:pr-6 lg:border-l lg:border-t-0 lg:px-6",
  "border-t sm:border-l sm:pl-6 lg:border-t-0 lg:px-6",
];

interface Stage {
  no: string;
  title: string;
  figure: ReactNode;
  text: string;
  note: ReactNode;
}

function stagesOf(stats: SiteStats | null): Stage[] {
  const kinds = stats ? KIND_ORDER.filter(([k]) => stats.sourceKinds[k]).map(([k, label]) => `${label} ${stats.sourceKinds[k]}`).join(" · ") : null;
  return [
    {
      no: "01",
      title: "采集",
      figure: stats && <Figure n={stats.sources} unit="个信源" />,
      text: ABOUT.steps.collect,
      note: kinds,
    },
    {
      no: "02",
      title: "收录",
      figure: stats && <Figure n={stats.items} unit="条动态" />,
      text: ABOUT.steps.store,
      note: stats && <><Text>过去 24 小时收进 </Text><Text>{stats.day.collected.toLocaleString("en-US")}</Text><Text> 条</Text></>,
    },
    {
      no: "03",
      title: "精选",
      figure: stats && <Figure n={stats.selected} unit={REPORTS.metricUnits.selectedCount} />,
      text: ABOUT.steps.select,
      note: stats && <><Text>过去 24 小时 </Text><Text>{stats.day.selected}</Text><Text> 条进了精选</Text></>,
    },
    {
      no: "04",
      title: "成刊",
      figure: stats && <Figure n={stats.dailies} unit={REPORTS.metricUnits.reportsCovered} />,
      text: ABOUT.steps.publish,
      note: "也可以用 RSS、API、MCP 订阅",
    },
  ];
}

/** The maker's round avatar before the greeting; it steps aside if the image fails. */
function MakerFace({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt={`${ABOUT.maker?.name ?? ""}的头像`} width={48} height={48} onError={() => setFailed(true)} className="size-11 shrink-0 rounded-full bg-bg-sunk object-cover ring-1 ring-line xl:size-12" />;
}

function QrCard({ src, kind, title, note }: { src: string; kind: string; title: string; note: string }) {
  return (
    <figure className="card flex items-center gap-5 p-5">
      <img src={src} alt={`${kind}二维码`} width={112} height={112} loading="lazy" className="size-[104px] shrink-0 rounded-tile border border-line bg-white object-contain p-1.5 sm:size-[112px]" />
      <figcaption className="min-w-0">
        <div className="text-[12px] text-ink-4"><Text>{kind}</Text></div>
        <div className="mt-1 text-[16px] font-semibold leading-snug text-ink"><Text>{title}</Text></div>
        <p className="mt-2 text-[13px] leading-[1.7] text-ink-3"><Text>{note}</Text></p>
      </figcaption>
    </figure>
  );
}

/**
 * The optional maker block (ABOUT.maker): a greeting on the left, the contact codes that are set on the
 * right. Without the contact settings (the api did not answer) the codes stay out, as the figures do.
 */
function Maker({ maker, contact }: { maker: NonNullable<typeof ABOUT.maker>; contact: SiteContact | null }) {
  const translate = useText();
  const codes = [
    contact?.wechatQr && maker.wechat ? <QrCard key="wechat" src={contact.wechatQr} kind={maker.wechat.kind} title={translate(maker.wechat.title)} note={maker.wechat.note} /> : null,
    contact?.feishuQr && maker.feishu ? <QrCard key="feishu" src={contact.feishuQr} kind={maker.feishu.kind} title={translate(maker.feishu.title)} note={maker.feishu.note} /> : null,
  ].filter(Boolean);
  return (
    <section aria-labelledby="maker" className="mt-20 grid gap-10 xl:mt-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
      <div>
        <Kicker><Text>做这个站的人</Text></Kicker>
        <h2 id="maker" className="mt-4 flex items-center gap-3.5 text-[26px] font-black leading-[1.3] tracking-[-0.02em] text-ink xl:gap-4 xl:text-[34px]">
          {contact?.makerAvatar && <MakerFace src={contact.makerAvatar} />}
          <span><Text>
            嗨，我是 </Text><span className="whitespace-nowrap text-accent"><Text>{maker.name}</Text></span>
          </span>
        </h2>
        <div className="mt-5 space-y-4 text-[15.5px] leading-[1.9] text-ink-2 xl:text-[16.5px]">
          {maker.greeting.map((line) => (
            <p key={line}><Text>{line}</Text></p>
          ))}
          <p className="text-ink-3"><Text>
            它一直在改，改了什么都写在
            </Text><Link viewTransition={routeViewTransition()} to="/changelog" className="text-accent hover:underline"><Text>
              更新日志
            </Text></Link><Text>
            里；有想法、遇到问题，去
            </Text><Link viewTransition={routeViewTransition()} to="/feedback" className="text-accent hover:underline"><Text>
              反馈页
            </Text></Link><Text>
            告诉我。
          </Text></p>
        </div>
      </div>
      {codes.length > 0 && (
        <div className="grid content-start gap-3">
          <h3 className="text-[15px] font-semibold text-ink"><Text>如果觉得有点用，欢迎加入</Text></h3>
          <Text>{codes}</Text>
        </div>
      )}
    </section>
  );
}

/** The latest 精选 under the river's paper; it moves on each time an item reaches the paper. */
function Latest({ item, className = "" }: { item: SiteStats["latest"][number] | undefined; className?: string }) {
  if (!item) return null;
  return (
    <IntentLink viewTransition to={`/items/${item.id}`} className={`group block ${className}`}>
      <span className="text-[11px] font-semibold tracking-[0.2em] text-accent"><Text>{EDITORIAL.selectionEnabled ? "最近精选" : "历史精选"}</Text></span>
      <span key={item.id} className="animate-fade-up mt-1.5 block">
        <span className="line-clamp-2 text-[13.5px] font-semibold leading-[1.55] text-ink transition-colors group-hover:text-accent"><Text content>{item.title}</Text></span>
        <span className="mt-1 block truncate text-[12px] text-ink-4"><Text>{item.source}</Text></span>
      </span>
    </IntentLink>
  );
}

export default function AboutPage() {
  const translate = useText();
  const { contact, stats } = useLoaderData<typeof loader>();
  const [focus, setFocus] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const shown = useRef(0);
  const sources = useMemo(() => stats?.sampleSources ?? NO_SOURCES, [stats]);
  const stages = useMemo(() => stagesOf(stats), [stats]);
  const latest = stats?.latest ?? [];
  // A pulse reaches the paper every second or so; the headline under it changes at most every 2.8s.
  const onArrive = useCallback(() => {
    const now = Date.now();
    if (now - shown.current < 2800 || latest.length < 2) return;
    shown.current = now;
    setAt((i) => (i + 1) % latest.length);
  }, [latest.length]);

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-14 lg:pt-3">
      <PhoneBar back={{ to: "/more", label: "我的" }} title={translate(`关于 ${SITE.name}`)} />
      {!EDITORIAL.selectionEnabled && <p className="mb-6 rounded-control border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink-3"><Text>建设期自动精选已暂停，当前以资讯和日报为主。下方展示保留的精选机制与历史结果。</Text></p>}
      <header className="grid items-end gap-8 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-0">
        <div>
          <Kicker><Text>{ABOUT.kicker}</Text></Kicker>
          <h1 data-page-title="" className="mt-5 text-[34px] font-black leading-[1.18] tracking-[-0.03em] text-ink [text-wrap:balance] sm:text-[46px] xl:text-[56px] 2xl:text-[64px]">
            <Text>{ABOUT.headline[0]}</Text>
            <br />
            <span className="text-accent"><Text>{ABOUT.headline[1]}</Text></span>
          </h1>
          <p className="mt-5 max-w-[36em] text-[15.5px] leading-[1.85] text-ink-3 xl:text-[17px]">
            {ABOUT.lead.split("{sources}").map((part, i) => (
              <Fragment key={i}>
                {i > 0 && (stats ? <><Text>{" "}</Text><span className="num font-semibold text-ink"><Text>{stats.sources}</Text></span><Text>{" "}</Text></> : ABOUT.sourcesFallback)}
                <Text>{part}</Text>
              </Fragment>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:pb-2">
          <IntentLink to="/" className={buttonClass("primary", "lg")}><Text>
            {EDITORIAL.selectionEnabled ? "看今天的精选" : "浏览资讯"} </Text><IconArrowRight size={15} />
          </IntentLink>
          <IntentLink to="/daily" className={buttonClass("secondary", "lg")}><Text>
            读最新日报
          </Text></IntentLink>
        </div>
      </header>

      <section aria-labelledby="how" className="mt-10 xl:mt-14">
        <h2 id="how" className="sr-only">
          <Text>{`${SITE.name} 怎么工作`}</Text>
        </h2>
        <SignalRiver sources={sources} focus={focus} onArrive={onArrive} className="h-[230px] sm:h-[300px] lg:h-[360px] 2xl:h-[420px]">
          <Latest item={latest[at]} className="absolute left-[75%] top-[calc(42%+42px)] hidden w-[25%] px-6 lg:block" />
        </SignalRiver>
        <p className="sr-only"><Text>{`示意图：每条线是一个信源；线汇成一束束，代表同一件事的多篇报道；经过精选的闸门，只有少数几束通过，${subjectAfter("汇入每天的", "日报")}。`}</Text></p>
        <Latest item={latest[at]} className="mt-2 border-t border-line pt-4 lg:hidden" />
        <ol className="mt-4 grid grid-cols-1 border-t border-line-strong sm:grid-cols-2 lg:mt-0 lg:grid-cols-4">
          {stages.map((s, i) => (
            <li
              key={s.no}
              tabIndex={0}
              onPointerEnter={() => setFocus(i)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(i)}
              onBlur={() => setFocus(null)}
              className={`border-line py-6 outline-none transition-colors ${STAGE_CELL[i]} ${focus === i ? "bg-accent-softer" : ""}`}
            >
              <div className="flex items-baseline gap-2.5">
                <span className="num text-[12px] font-bold tracking-[0.12em] text-accent"><Text>{s.no}</Text></span>
                <h3 className="text-[17px] font-bold text-ink"><Text content>{s.title}</Text></h3>
              </div>
              {s.figure && <div className="mt-4"><Text>{s.figure}</Text></div>}
              <p className="mt-3 text-[14px] leading-[1.8] text-ink-3"><Text>{s.text}</Text></p>
              {s.note && <p className="mt-3 text-[12px] text-ink-4"><Text>{s.note}</Text></p>}
            </li>
          ))}
        </ol>
      </section>

      {ABOUT.maker && <Maker maker={ABOUT.maker} contact={contact} />}

      <p className="mt-16 well rounded-card px-5 py-4 text-[13px] leading-[1.85] text-ink-3">
        <Text>{ABOUT.copyright[0]}</Text>
        <Link viewTransition={routeViewTransition()} to="/feedback" className="text-accent hover:underline"><Text>
          反馈页
        </Text></Link>
        <Text>{ABOUT.copyright[1]}</Text>
      </p>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-[12.5px] text-ink-4">
        <span><Text>{SITE.footerNote}</Text></span>
        <nav className="flex gap-5" aria-label={translate("规则与隐私")}>
          <Link
            viewTransition={routeViewTransition()}
            id={ABOUT.termsAnchor ?? undefined}
            to="/terms"
            className="transition-colors hover:text-accent"
          >
            <Text>{POLICY.terms.name}</Text>
          </Link>
          <Link viewTransition={routeViewTransition()} to="/privacy" className="transition-colors hover:text-accent"><Text>
            隐私说明
          </Text></Link>
        </nav>
      </footer>
    </div>
  );
}
