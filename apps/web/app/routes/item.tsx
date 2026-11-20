import { routeViewTransition } from "@aihot/web/components/shell/transitions";
import { Text, useText } from "@aihot/web/lib/text";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Await, isRouteErrorResponse, Link, useAsyncError, useLoaderData, useNavigate, useRevalidator, type ClientLoaderFunctionArgs } from "react-router";
import type { Route } from "./+types/item";
import type { FeedItemSummary, SiteItemDetail } from "@aihot/contracts/site";
import { EDITORIAL, ITEM_COPY, SITE } from "@aihot/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { articleLd, breadcrumbLd, pageMeta, siteUrl, titled } from "../lib/seo";
import { fullDateTime, relativeTime } from "../lib/format";
import { markRead } from "../lib/local-state";
import { SameEventBadge, SelectedBadge, UnverifiedBadge } from "../components/ui/Badge";
import { ScoreLabel, shownScore } from "../components/ui/Score";
import { PillTabs } from "../components/ui/Tabs";
import { ArticleLayout, RailSection } from "../components/ui/Page";
import { Menu, MenuItem } from "../components/ui/Menu";
import { StarButton } from "../features/feed/parts";
import { GroupButton, GroupSources } from "../features/feed/ReadingGroup";
import { StoryFollowups } from "../features/item/StoryFollowups";
import { MediaGallery } from "../features/item/MediaGallery";
import { QuotedPost } from "../features/item/QuotedPost";
import { ArticleBody } from "../features/item/ArticleBody";
import { ActionsSheet, ReaderToolbar, type ActionRow } from "../features/item/ReaderTools";
import { OutlineSheet, scrollToAnchor } from "../components/ui/OutlineSheet";
import { takePreview } from "../features/item/preview";
import { IconArrowLeft, IconCopy, IconDownload, IconExternal, IconImage, IconMenu, IconMore, IconShare } from "../components/icons";
import { BarButton, PhoneBar } from "../components/shell/PhoneBar";
import { isPhone, type Screen } from "../components/shell/screens";

export const handle: Screen = { home: "featured", toolbar: true };
export { pageHeaders as headers } from "../lib/api.server";

const PosterSheet = lazy(() => import("../features/item/PosterSheet"));

export async function loader({ params, request }: Route.LoaderArgs) {
  const item = await loadOr404<SiteItemDetail>(`/api/site/items/${encodeURIComponent(params.id)}`, { signal: request.signal });
  return cachedPage(600, { item });
}

type Preview = { item: null; preview: FeedItemSummary; detail: Promise<{ item: SiteItemDetail }> };

/**
 * Phones: an article tapped in a list opens at once with what the card showed (title, summary, reason),
 * while its full text loads. Opened any other way, or on desktop, the page waits for its data as usual.
 */
const reuse = pageReuse<typeof loader>();
export const { shouldRevalidate } = reuse;
export async function clientLoader(args: ClientLoaderFunctionArgs) {
  const { params } = args;
  const preview = isPhone() && params.id ? takePreview(params.id) : null;
  if (!preview) return reuse.clientLoader(args);
  return { item: null, preview, detail: reuse.clientLoader(args) } satisfies Preview;
}
clientLoader.hydrate = true as const;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: titled("内容不存在") }, { name: "robots", content: "noindex" }];
  const { item } = loaderData;
  if (!item) return [{ title: titled(loaderData.preview.title) }];
  return pageMeta({
    title: item.title,
    description: item.summary ?? undefined,
    path: `/items/${item.id}`,
    image: `/og/items/${item.id}.png`,
    type: "article",
    noindex: !item.indexable,
    jsonLd: [
      articleLd({ path: `/items/${item.id}`, headline: item.title, description: item.summary, publishedAt: item.publishedAt, image: `/og/items/${item.id}.png`, basedOn: item.links.original }),
      breadcrumbLd([
        { name: SITE.name, path: "/" },
        { name: EDITORIAL.selectionEnabled && item.selected ? "精选" : "全部动态", path: EDITORIAL.selectionEnabled && item.selected ? "/" : "/all" },
        { name: item.title, path: `/items/${item.id}` },
      ]),
    ],
  });
}

/** A 2px accent line across the top that follows long bodies. */
function ReadingProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (ref.current) ref.current.style.transform = `scaleX(${max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left scale-x-0 bg-accent transition-transform duration-150 ease-out" />;
}

/** An outline link: a plain click scrolls in place (above); modifier clicks keep the browser's behaviour. */
function jumpTo(e: React.MouseEvent, id: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!document.getElementById(id)) return;
  e.preventDefault();
  scrollToAnchor(id);
}

function ArticleOutline({ outline }: { outline: SiteItemDetail["outline"] }) {
  const translate = useText();
  const ref = useRef<HTMLElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const nav = ref.current!;
    const list = nav.firstElementChild!;
    const rail = nav.closest("aside")!.firstElementChild!;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!nav.getClientRects().length) return;
      // Measure within the sticky rail, so scrolling the article cannot change the list's height.
      const inset = parseFloat(getComputedStyle(rail).top);
      const offset = nav.getBoundingClientRect().top - rail.getBoundingClientRect().top;
      const available = window.innerHeight - inset * 2 - offset;
      // A scrollbar can wrap the first entry. Use one line as the minimum to avoid toggling it.
      const entryStyle = getComputedStyle(list.firstElementChild!.firstElementChild!);
      const minimumHeight = parseFloat(entryStyle.lineHeight) + parseFloat(entryStyle.paddingTop) + parseFloat(entryStyle.paddingBottom);
      nav.style.maxHeight = available >= minimumHeight ? `${available}px` : "";
      setScrollable(nav.scrollHeight > nav.clientHeight);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(rail);
    resize.observe(list);
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);
  const containKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!scrollable || e.altKey || e.ctrlKey || e.metaKey) return;
    const nav = e.currentTarget;
    const up = ["ArrowUp", "PageUp", "Home"].includes(e.key) || (e.key === " " && e.shiftKey);
    const down = ["ArrowDown", "PageDown", "End"].includes(e.key) || (e.key === " " && !e.shiftKey);
    // WebKit can chain keyboard scrolling even with overscroll-behavior: contain.
    if ((up && nav.scrollTop <= 0) || (down && nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1)) e.preventDefault();
  };
  return (
    <RailSection title={translate("本文目录")}>
      <nav ref={ref} aria-label={translate("本文目录")} tabIndex={scrollable ? 0 : undefined} onKeyDown={containKeys} className={`article-outline scrollbar-thin overflow-y-auto${scrollable ? " overscroll-y-contain" : ""}`}>
        <ol className="space-y-0.5 border-l border-line">
          {outline.map((o) => (
            <li key={o.id}>
              <a href={`#${o.id}`} onClick={(e) => jumpTo(e, o.id)} className={`-ml-px block border-l border-transparent py-1 text-[12.5px] leading-snug text-ink-3 transition-colors hover:border-accent hover:text-ink focus-visible:outline-offset-[-2px] ${o.level > 2 ? "pl-5" : "pl-3"}`}>
                <Text>{o.text}</Text>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </RailSection>
  );
}

/** WeChat's in-app browser cannot save downloads: there the Markdown is copied instead. */
function inWeChat(): boolean {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function shareOrCopy(item: Pick<SiteItemDetail, "id" | "title">): Promise<"shared" | "copied" | null> {
  const url = `${siteUrl()}/items/${item.id}`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: item.title, url });
      return "shared";
    }
    await navigator.clipboard.writeText(`${item.title}\n${url}`);
    return "copied";
  } catch {
    return null;
  }
}

/** A short line over the page's foot, gone after a moment. */
function useToast(): [string | null, (text: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast];
}

function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-bg shadow-[var(--shadow-pop)] lg:bottom-8">
      <Text>{text}</Text>
    </div>
  );
}

export default function ItemPage() {
  const data = useLoaderData<typeof clientLoader>() as { item: SiteItemDetail } | Preview;
  if (data.item) return <ItemView key={`${data.item.id}:${data.item.bodyLanguage}`} item={data.item} />;
  return (
    <Suspense fallback={<ItemPreview preview={data.preview} />}>
      <Await resolve={data.detail} errorElement={<ItemGone />}>
        {(loaded) => <ItemView key={`${loaded.item.id}:${loaded.item.bodyLanguage}`} item={loaded.item} />}
      </Await>
    </Suspense>
  );
}

/** Phones, while the article loads: what the card showed, in the article's own places. */
function ItemPreview({ preview }: { preview: FeedItemSummary }) {
  const translate = useText();
  const [toast, setToast] = useToast();
  const isX = preview.channel === "x" && !!preview.x;
  // Without a reliable date from the original, the card's time is when it was collected, and says so.
  const shownAt = preview.publishedAt ?? preview.timelineAt;
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <PhoneBar back={{ to: EDITORIAL.selectionEnabled && preview.selected ? "/" : "/all", label: EDITORIAL.selectionEnabled && preview.selected ? "精选" : "资讯" }} title={translate(isX ? preview.x!.authorName : preview.title)} />
      <article className="pb-6 pt-3" aria-busy="true">
        <div className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-3">
          <span className="font-semibold text-ink-2"><Text>{isX ? preview.x!.authorName : preview.source.name}</Text></span>
          {isX && <span>· @<Text>{preview.x!.handle}</Text> · X</span>}
          <span>·</span>
          {!preview.publishedAt && <span><Text>收录于</Text></span>}
          <time dateTime={shownAt} className="mono"><Text>{fullDateTime(shownAt)}</Text></time>
          {EDITORIAL.selectionEnabled && preview.selected && <span className="ml-1">{preview.sameEvent ? <SameEventBadge /> : <SelectedBadge />}</span>}
          {preview.tags.includes("未经独立核实") && <UnverifiedBadge />}
          {shownScore(preview.score) !== null && (
            <span className="ml-1">
              <ScoreLabel score={preview.score} />
            </span>
          )}
        </div>
        {!isX && <h1 data-page-title="" className="text-[26px] font-bold leading-[1.38] tracking-[-0.01em] text-ink"><Text content>{preview.title}</Text></h1>}
        {preview.summary && (
          <section className={isX ? "mt-4" : "mt-7"}>
            <div className="mb-2 text-[12px] font-semibold text-accent"><Text>{isX && preview.summary.replace(/\s+/g, " ").trim() === preview.title ? "原文" : "AI 导读"}</Text></div>
            <p className="text-[18px] leading-[1.7] text-ink"><Text content>{preview.summary}</Text></p>
          </section>
        )}
        {EDITORIAL.selectionEnabled && preview.reason && (
          <section className="mt-6 border-t border-line pt-4">
            <div className="mb-1 text-[12px] font-semibold text-ink-3"><Text>{ITEM_COPY.reasonLabel}</Text></div>
            <p className="text-[15px] leading-[1.75] text-ink-2"><Text content>{preview.reason}</Text></p>
          </section>
        )}
        <div className="mt-9 space-y-3 border-t border-line pt-6" aria-hidden="true">
          {[92, 100, 96, 88, 98, 64].map((w, i) => (
            <div key={i} className="skeleton h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      </article>
      <ReaderToolbar
        item={preview}
        originalLabel={isX ? "原推" : "原文"}
        onShare={async () => {
          if ((await shareOrCopy(preview)) === "copied") setToast("链接已复制");
        }}
      />
      <Toast text={toast} />
    </div>
  );
}

/** The article could not load after the tap: gone (withdrawn, merged away), or the service is busy. */
function ItemGone() {
  const error = useAsyncError();
  const revalidator = useRevalidator();
  const gone = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="mx-auto max-w-sm pb-8">
      <PhoneBar back={{ to: EDITORIAL.selectionEnabled ? "/" : "/all", label: EDITORIAL.selectionEnabled ? "精选" : "资讯" }} />
      <div className="py-24 text-center">
        <div className="text-[20px] font-bold text-ink"><Text>{gone ? "这里没有内容" : "暂时无法加载"}</Text></div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3"><Text>{gone ? "这篇内容不存在，或已不再公开。" : "服务暂时繁忙，请稍后再试。"}</Text></p>
        {!gone && (
          <button type="button" onClick={() => void revalidator.revalidate()} className="mt-6 h-11 rounded-full border border-line-strong bg-surface px-5 text-[14px] font-medium text-ink-2 active:bg-bg-sunk"><Text>
            重试
          </Text></button>
        )}
      </div>
    </div>
  );
}

function ItemView({ item }: { item: SiteItemDetail }) {
  const translate = useText();
  const navigate = useNavigate();
  const hasTranslation = item.hasTranslation;
  const lang = item.bodyLanguage;
  const [posterRequested, setPosterRequested] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [toast, setToast] = useToast();
  useEffect(() => { markRead(item.id); }, [item.id]);
  const closePoster = useCallback(() => setPosterOpen(false), []);
  const openPoster = () => {
    setPosterRequested(true);
    setPosterOpen(true);
  };
  const share = async () => {
    const r = await shareOrCopy(item);
    if (r === "copied") setToast("链接已复制");
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${siteUrl()}/items/${item.id}`);
      setToast("链接已复制");
    } catch {
      // clipboard unavailable
    }
  };
  const copyMarkdown = async () => {
    try {
      const res = await fetch(`/items/${item.id}/markdown`);
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setToast("Markdown 已复制");
    } catch {
      setToast("复制失败，请在浏览器中打开后导出");
    }
  };

  const bodyHtml = lang === "zh" ? (item.body?.zh ?? item.body?.original) : (item.body?.original ?? item.body?.zh);
  const bodyLabel = !item.body ? null : lang === "zh" && item.body.zhKind === "translation" ? "正文 · AI 翻译" : lang === "original" && hasTranslation ? "正文 · 原文" : "正文";
  const isX = item.channel === "x" && !!item.x;
  // Without a reliable date from the original, the time shown is when it was collected, labelled as such.
  const shownAt = item.publishedAt ?? item.discoveredAt;
  const timeLabel = item.publishedAt ? "发布时间" : "收录时间";
  const summaryOnly = item.readingMode === "summary-only";
  const showOutline = item.outline.length >= 3;
  const originalLabel = isX ? "在 X 查看原推" : "打开原文";

  const related = item.relatedStories.filter((s) => s.publicId !== item.story?.publicId);

  const back = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(EDITORIAL.selectionEnabled && item.selected ? "/" : "/all");
  };
  const backButton = (
    <button type="button" onClick={back} className="-ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-full px-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink">
      <IconArrowLeft size={16} /><Text> 返回
    </Text></button>
  );
  const moreMenu = (
    <Menu label="更多操作" trigger={<IconMenu size={17} />}>
      {(close) => (
        <>
          <MenuItem icon={<IconShare size={15} />} onSelect={() => { close(); void share(); }}><Text>分享链接</Text></MenuItem>
          <MenuItem icon={<IconImage size={15} />} onSelect={() => { close(); openPoster(); }}><Text>生成分享海报</Text></MenuItem>
          <MenuItem icon={<IconCopy size={15} />} onSelect={() => { close(); void copyLink(); }}><Text>复制链接</Text></MenuItem>
          {item.markdownAvailable &&
            (inWeChat() ? (
              <MenuItem icon={<IconDownload size={15} />} onSelect={() => { close(); void copyMarkdown(); }}><Text>复制 Markdown</Text></MenuItem>
            ) : (
              <MenuItem icon={<IconDownload size={15} />} href={`/items/${item.id}/markdown`} download onSelect={close}><Text>
                导出 Markdown
              </Text></MenuItem>
            ))}
        </>
      )}
    </Menu>
  );
  // Phones: the same actions as a sheet from the bar (分享 and 原文 are on the toolbar).
  const phoneActions: ActionRow[] = [
    { key: "poster", label: "生成分享海报", icon: <IconImage size={20} />, onSelect: openPoster },
    { key: "copy", label: "复制链接", icon: <IconCopy size={20} />, onSelect: () => void copyLink() },
    ...(item.markdownAvailable
      ? [inWeChat()
        ? { key: "markdown", label: "复制 Markdown", icon: <IconDownload size={20} />, onSelect: () => void copyMarkdown() }
        : { key: "markdown", label: "导出 Markdown", icon: <IconDownload size={20} />, href: `/items/${item.id}/markdown`, download: true }]
      : []),
  ];
  // Desktop actions head the right rail, one row as tall as 返回 at the head of the left one.
  const actions = (
    <div className="flex items-center gap-1">
      <a
        href={item.links.original}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
      >
        <Text>{originalLabel}</Text> <IconExternal size={13} />
      </a>
      <StarButton item={item} size={32} />
      <Text>{moreMenu}</Text>
    </div>
  );
  const verdict = EDITORIAL.selectionEnabled && (item.selected || shownScore(item.score) !== null) && (
    <div className="flex items-center gap-2">
      {EDITORIAL.selectionEnabled && item.selected && (item.sameEvent ? <SameEventBadge /> : <SelectedBadge />)}
      <ScoreLabel score={item.score} />
    </div>
  );

  // Rails: the piece's facts on the left (wide screens), the editor's notes on the right, the outline
  // under the facts (or under the notes when only the right rail shows).
  const facts = (
    <RailSection title={translate("来源")}>
      <div className="text-[14px] font-semibold leading-snug text-ink"><Text>{isX ? item.x!.authorName : item.source.name}</Text></div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
        <Text>{isX ? `@${item.x!.handle} · X` : item.author ?? hostOf(item.links.original)}</Text>
      </div>
      <div className="mt-3 text-[12px] text-ink-4"><Text>{timeLabel}</Text></div>
      <time dateTime={shownAt} className="mono mt-0.5 block text-[12.5px] text-ink-2">
        <Text>{fullDateTime(shownAt)}</Text>
      </time>
      <div className="mt-0.5 text-[12px] text-ink-4" suppressHydrationWarning>
        <Text>{relativeTime(shownAt)}</Text>
      </div>
    </RailSection>
  );
  const outline = showOutline && <ArticleOutline outline={item.outline} />;
  const notes = (
    <>
      {EDITORIAL.selectionEnabled && item.reason && !summaryOnly ? (
        <RailSection title={translate(ITEM_COPY.reasonLabel)}>
          {verdict && <div className="mb-3"><Text>{verdict}</Text></div>}
          <p className="text-[13.5px] leading-[1.8] text-ink-2"><Text content>{item.reason}</Text></p>
        </RailSection>
      ) : (
        verdict && <RailSection title={translate(shownScore(item.score) !== null ? "AI 评分" : undefined)}><Text>{verdict}</Text></RailSection>
      )}
      {item.topics.length > 0 && (
        <RailSection title={translate("主题")}>
          <div className="flex flex-wrap gap-1.5">
            {item.topics.map((t) => (
              <Link viewTransition={routeViewTransition()} key={t.slug} to={`/topics/${t.slug}`} className="chip">
                <Text>{t.name}</Text>
              </Link>
            ))}
          </div>
        </RailSection>
      )}
      {item.tags.length > 0 && (
        <RailSection title={translate("标签")}>
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 8).map((t) => (
              <Link key={t} to={`/all?tag=${encodeURIComponent(t)}`} rel="nofollow" className="chip">
                #<Text>{t}</Text>
              </Link>
            ))}
          </div>
        </RailSection>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      {item.body && <ReadingProgress />}

      {/* Phones: back to where the reader came from, the title once it has scrolled away, more actions. */}
      <PhoneBar
        back={{ to: EDITORIAL.selectionEnabled && item.selected ? "/" : "/all", label: EDITORIAL.selectionEnabled && item.selected ? "精选" : "资讯" }}
        title={translate(isX ? item.x!.authorName : item.title)}
        actions={
          <BarButton label="更多操作" onClick={() => setActionsOpen(true)}>
            <IconMore size={22} />
          </BarButton>
        }
      />

      {/* The text on the page in one column; back and the facts in the left rail, actions and notes in the right. */}
      <ArticleLayout
        left={
          <>
            <Text>{backButton}</Text>
            <Text>{facts}</Text>
            <Text>{outline}</Text>
          </>
        }
        right={
          <>
            <Text>{actions}</Text>
            <Text>{notes}</Text>
            <div className="space-y-8 2xl:hidden"><Text>{outline}</Text></div>
          </>
        }
      >
        {/* Between lg and 2xl the left rail is hidden: 返回 stays at the top while reading, as on the original site. */}
        <div className="sticky top-[var(--masthead-h)] z-20 -mx-2 hidden bg-bg/95 px-2 py-1.5 backdrop-blur lg:block 2xl:hidden"><Text>{backButton}</Text></div>
        <article className="pb-6 pt-3 lg:pt-2 2xl:pt-1">
          <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-3 2xl:hidden ${isX ? "" : "mb-3"}`}>
            <span className="font-semibold text-ink-2"><Text>{isX ? item.x!.authorName : item.source.name}</Text></span>
            {isX && <span>· @<Text>{item.x!.handle}</Text> · X</span>}
            {item.author && !isX && <span>· <Text>{item.author}</Text></span>}
            <span>·</span>
            {!item.publishedAt && <span><Text>收录于</Text></span>}
            <time dateTime={shownAt} className="mono"><Text>{fullDateTime(shownAt)}</Text></time>
            <span suppressHydrationWarning>· <Text>{relativeTime(shownAt)}</Text></span>
            {EDITORIAL.selectionEnabled && item.selected && (
              <span className="ml-1 lg:hidden">
                {item.sameEvent ? <SameEventBadge /> : <SelectedBadge />}
              </span>
            )}
            {shownScore(item.score) !== null && (
              <span className="ml-1 lg:hidden">
                <ScoreLabel score={item.score} />
              </span>
            )}
          </div>
          {!isX && <h1 data-page-title="" className="text-[26px] font-bold leading-[1.38] tracking-[-0.01em] text-ink lg:text-[32px] lg:leading-[1.34] xl:text-[36px] xl:leading-[1.3]"><Text content>{item.title}</Text></h1>}
          {!isX && item.originalTitle && <p className="mt-2.5 text-[14px] leading-relaxed text-ink-4"><Text>{item.originalTitle}</Text></p>}

          {item.tags.includes("未经独立核实") && <div className="my-3"><UnverifiedBadge /></div>}
          {item.summary && (!isX || item.summary.replace(/\s+/g, " ").trim() !== item.title) && (
            <section className={isX ? "mt-4" : "mt-7 xl:mt-8"}>
              <div className="mb-2 text-[12px] font-semibold text-accent"><Text>{summaryOnly ? "摘要" : "AI 导读"}</Text></div>
              <p className="text-[18px] leading-[1.7] text-ink xl:text-[20px] xl:leading-[1.7]"><Text content>{item.summary}</Text></p>
            </section>
          )}

          {EDITORIAL.selectionEnabled && item.reason && !summaryOnly && (
            <section className="mt-6 border-t border-line pt-4 lg:hidden">
              <div className="mb-1 text-[12px] font-semibold text-ink-3"><Text>{ITEM_COPY.reasonLabel}</Text></div>
              <p className="text-[15px] leading-[1.75] text-ink-2"><Text content>{item.reason}</Text></p>
            </section>
          )}

          {EDITORIAL.selectionEnabled && item.sameEvent && (
            <p className="mt-5 text-[13px] leading-relaxed text-ink-4"><Text>
              同一新闻，精选展示
              </Text><Link viewTransition={routeViewTransition()} to={`/items/${item.sameEvent.id}`} className="text-ink-3 transition-colors hover:text-accent">
                《<Text content>{item.sameEvent.title}</Text>》
              </Link>
            </p>
          )}

          {item.group && item.group.reportCount > 1 && (
            <div className="mt-5">
              <div className="hidden lg:block"><GroupSources group={item.group} parentId={item.id} /></div>
              <GroupButton group={item.group} parentId={item.id} />
            </div>
          )}

          {summaryOnly && <p className="mt-7 rounded-control bg-bg-sunk px-4 py-3 text-[13.5px] leading-relaxed text-ink-3"><Text>应来源方要求，这里只提供摘要与原文入口。完整内容请阅读原文。</Text></p>}

          {item.body && bodyHtml && (
            <section className="mt-9 border-t border-line pt-4 xl:mt-10">
              <div className="mb-6 flex items-center justify-between gap-3">
                <span className="text-[12px] text-ink-4"><Text>{bodyLabel}</Text></span>
                {hasTranslation && (
                  <PillTabs
                    size="xs"
                    layoutId="item-body-lang"
                    label="正文语言"
                    active={lang}
                    items={[
                      { key: "zh", label: "中文", prefetch: "intent", replace: true, to: `/items/${item.id}` },
                      { key: "original", label: "原文", prefetch: "intent", replace: true, to: `/items/${item.id}/original` },
                    ]}
                  />
                )}
              </div>
              {hasTranslation && lang === "zh" && !item.body.complete && (
                <p className="mb-5 rounded-control bg-bg-sunk px-3 py-2 text-[13px] text-ink-3"><Text>译文尚不完整，完整内容请切换到原文。</Text></p>
              )}
              <ArticleBody html={bodyHtml} />
            </section>
          )}

          {isX && item.x!.media.length > 0 && <MediaGallery media={item.x!.media} postUrl={item.links.original} />}
          {isX && item.x!.quoted?.text && <QuotedPost quoted={item.x!.quoted} original={lang === "original"} />}

          <p className="mt-8 text-[13px] text-ink-4"><Text>
            来源：
            </Text><a href={item.links.original} target="_blank" rel="noopener noreferrer" className="text-ink-3 hover:text-accent">
              <Text>{isX ? item.x!.authorName : item.source.name}</Text>
            </a>
            <span> · <Text>{hostOf(item.links.original)}</Text></span>
          </p>

          {(item.topics.length > 0 || item.tags.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-1.5 lg:hidden">
              {item.topics.map((t) => (
                <Link viewTransition={routeViewTransition()} key={t.slug} to={`/topics/${t.slug}`} className="chip">
                  <Text>{t.name}</Text>
                </Link>
              ))}
              {item.tags.slice(0, 6).map((t) => (
                <Link key={t} to={`/all?tag=${encodeURIComponent(t)}`} rel="nofollow" className="chip">
                  #<Text>{t}</Text>
                </Link>
              ))}
            </div>
          )}

          {item.story && <StoryFollowups story={item.story} currentId={item.id} />}

          {related.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-[14px] font-semibold text-ink"><Text>相关事件</Text></h2>
              <ul className="divide-y divide-line-soft">
                {related.map((s) => (
                  <li key={s.publicId}>
                    <Link viewTransition={routeViewTransition()} to={`/story/${s.publicId}`} className="block py-2.5 text-[14px] text-ink-2 hover:text-accent">
                      <Text content>{s.title}</Text>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </ArticleLayout>

      <ReaderToolbar
        item={item}
        originalUrl={item.links.original}
        originalLabel={isX ? "原推" : "原文"}
        onOutline={showOutline ? () => setOutlineOpen(true) : undefined}
        onShare={() => void share()}
      />
      {showOutline && <OutlineSheet open={outlineOpen} onClose={() => setOutlineOpen(false)} outline={item.outline} />}
      <ActionsSheet open={actionsOpen} onClose={() => setActionsOpen(false)} rows={phoneActions} />

      {posterRequested && (
        <Suspense fallback={null}>
          <PosterSheet id={item.id} title={translate(item.title)} open={posterOpen} onClose={closePoster} />
        </Suspense>
      )}
      <Toast text={toast} />
    </div>
  );
}
