import { Text, useText } from "@aihot/web/lib/text";
// One visible category control; active tags and queries can be removed independently.
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import { READER_CATEGORY_OPTIONS, readerCategory, type CategoryKey } from "@aihot/contracts/taxonomy";
import { IconClose, IconSearch } from "../../components/icons";
import { IntentLink } from "../../components/ui/IntentLink";

/** Same page with some query parameters changed (paging state dropped). */
function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  sp.delete("deep");
  sp.delete("anchorAt");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** Category, tag and search are independent filters. */
function filterOptions(base: string, params: URLSearchParams, noneLabel: string) {
  return [
    { key: "all", label: noneLabel, to: hrefWith(base, params, { category: null }) },
    ...READER_CATEGORY_OPTIONS.map(({ key, label }) => ({ key, label, to: hrefWith(base, params, { category: key }) })),
  ];
}

function filterKey(category: CategoryKey | null): string {
  return category ? readerCategory(category) : "all";
}

/** Desktop: the filter as a row of tabs beside the search field. */
export function CategoryTabs({ base, category, className = "" }: { base: string; category: CategoryKey | null; className?: string }) {
  const translate = useText();
  const [params] = useSearchParams();
  const combinesFilters = params.has("tag") || params.has("q");
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    const revealActive = () => {
      const nav = rail.current;
      const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
      const bounds = nav.getBoundingClientRect(), item = active.getBoundingClientRect();
      if (item.left < bounds.left || item.right > bounds.right) {
        nav.scrollTo({ left: nav.scrollLeft + item.left - bounds.left - (bounds.width - item.width) / 2 });
      }
    };
    revealActive();
    window.addEventListener("resize", revealActive);
    return () => window.removeEventListener("resize", revealActive);
  }, [category, translate]);
  return <nav ref={rail} aria-label={translate("栏目")} className={`category-tabs ${className}`}>
    {filterOptions(base, params, "综合").map(option => <IntentLink key={option.key} to={option.to} preventScrollReset
      rel={combinesFilters ? "nofollow" : undefined}
      aria-current={option.key === filterKey(category) ? "page" : undefined}><Text>{option.label}</Text></IntentLink>)}
  </nav>;
}

/** Feed pages share the brand header's search; avoid stacking two phone toolbars. */
export function FeedBar({ base }: { base: "/" | "/all" }) {
  return <h1 data-feed-page="" className="sr-only lg:hidden"><Text>{base === "/" ? "精选" : "全部动态"}</Text></h1>;
}

/** Empty lists offer a way out without making readers hunt for the filter controls. */
export function FilterRecovery({ base }: { base: "/" | "/all" }) {
  const [params] = useSearchParams();
  const filtered = ["category", "tag"].some(key => params.has(key));
  return <div className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-[13px] font-medium text-accent">
    {filtered && <Link to={hrefWith(base, params, { category: null, tag: null })} className="inline-flex min-h-11 items-center hover:underline"><Text>清除筛选</Text></Link>}
    {base === "/" && <Link to={hrefWith("/all", params, {})} className="inline-flex min-h-11 items-center hover:underline"><Text>查看全部动态</Text></Link>}
  </div>;
}

/** Applied tags and queries stay visible and each can be cleared without losing the others. */
export function ActiveFilters({ base, tag }: { base: string; tag: string | null }) {
  const translate = useText();
  const [params] = useSearchParams();
  const query = params.get("q")?.trim();
  if (!tag && !query) return null;
  const chip = "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full bg-accent-soft pl-3 pr-2 text-[13px] font-medium text-accent transition-opacity active:opacity-60";
  return (
    <div className="flex flex-wrap gap-2 pb-3 pt-1">
      {query && <Link to={hrefWith(base, params, { q: null, tab: null })} aria-label={translate(`取消搜索：${query}`)} className={chip}>
        <IconSearch size={14} className="shrink-0" /><span className="truncate">{query}</span><IconClose size={14} strokeWidth={2} className="shrink-0" />
      </Link>}
      {tag && (
        <Link to={hrefWith(base, params, { tag: null })} aria-label={translate(`取消标签：${tag}`)} className={chip}>
          <span className="truncate">#<Text>{tag}</Text></span>
          <IconClose size={14} strokeWidth={2} className="shrink-0" />
        </Link>
      )}
    </div>
  );
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/** Desktop search field (GET /all?q=…): at the end of the filter row as the same grey track, at the height of md tabs, with a "/" hint. */
export function SearchField({ defaultValue = "", keep = {} }: { defaultValue?: string; keep?: Record<string, string | null> }) {
  const translate = useText();
  const [hasText, setHasText] = useState(!!defaultValue);
  const navigation = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  // Keep pre-hydration edits; only a different URL query resets the field.
  const previousQuery = useRef(defaultValue);
  useEffect(() => {
    if (inputRef.current && previousQuery.current !== defaultValue) inputRef.current.value = defaultValue;
    previousQuery.current = defaultValue;
    setHasText(!!inputRef.current?.value);
  }, [defaultValue]);
  useSlashFocus(inputRef);
  const searching = navigation.state === "loading" && navigation.location?.pathname === "/all" && !!new URLSearchParams(navigation.location.search).get("q");
  const searchLabel = keep.tab === "relevance" ? "搜索标题、摘要与正文" : "搜索标题与摘要";
  const hidden = Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));

  return (
    <Form method="get" action="/all" role="search" className="group relative w-full shrink-0 lg:w-60">
      <Text>{hidden}</Text>
      <label htmlFor="site-search" className="sr-only"><Text>
        {searchLabel}
      </Text></label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        defaultValue={defaultValue}
        onInput={(e) => setHasText(!!e.currentTarget.value)}
        placeholder={translate(keep.tab === "relevance" ? "全文搜索…" : "搜索标题、摘要…")}
        maxLength={200}
        autoComplete="off"
        className="h-[42px] w-full rounded-full bg-bg-sunk pl-10 pr-10 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface"
      />
      {hasText ? (
        <button
          type="button"
          aria-label={translate("清空")}
          onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            setHasText(false);
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
    </Form>
  );
}
