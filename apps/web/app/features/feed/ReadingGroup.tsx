import { routeViewTransition } from "@aihot/web/components/shell/transitions";
import { Text, useText } from "@aihot/web/lib/text";
// Reports and developments of one event. Desktop expands inline; phones use a sheet.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Collapse } from "../../components/ui/Presence";
import { Sheet } from "../../components/ui/Sheet";
import type { GroupInfo, GroupReport, GroupReportsResponse, TimelineFilters } from "@aihot/contracts/site";
import { IconArrowUpRight, IconChevronDown, IconChevronRight } from "../../components/icons";
import { monthDayTime } from "../../lib/format";
import { isReload } from "../../lib/restore";
import { listPath, filterParams } from "../../lib/seo";
import { sessionCache } from "../../lib/session-cache";

const reportsUrl = (group: GroupInfo, filters: TimelineFilters | undefined) =>
  listPath(`/api/site/groups/${encodeURIComponent(group.factId)}/reports`, { ...(filters ? filterParams(filters) : {}), scope: group.scope });

const labelOf = (group: GroupInfo) => (group.developmentCount ?? 0) > 1 ? `${group.developmentCount} 条进展 · ${group.reportCount} 篇报道` : (group.additionalSourceCount > 0 ? `另有 ${group.additionalSourceCount} 家信源报道` : `${group.reportCount} 篇报道`);

// The groups left open in each history entry, with what they showed (null: still loading): back from an
// item finds them open again. In memory for back within the app; in session storage for a page the
// browser reloaded on back/forward.
const openGroups = sessionCache<{ savedAt: number; groups: Record<string, GroupReport[] | null> }>("aihot:open-groups:", 30 * 60 * 1000);

/** Keeps what an open group shows for its history entry; `undefined` forgets a closed one. */
function remember(entry: string, key: string, reports: GroupReport[] | null | undefined) {
  const groups = openGroups.peek(entry)?.groups;
  // Most groups are never opened: nothing to read or write for them.
  if (reports === undefined && !(groups && key in groups)) return;
  const next = { ...(groups ?? openGroups.read(entry)?.groups) };
  if (reports === undefined) delete next[key];
  else next[key] = reports;
  openGroups.set(entry, { savedAt: Date.now(), groups: next });
}

/**
 * A fact's reports under the list's filters, read by `load`. Read `again` (on return), the rows shown stay
 * until the new ones arrive, and a group with no reports left shows none.
 */
function useReports(url: string, saved: GroupReport[] | null = null) {
  const [state, setState] = useState({ url, reports: saved, loading: false, error: false });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [url]);
  const current = state.url === url ? state : { url, reports: null, loading: false, error: false };
  const load = async (again = false) => {
    request.current?.abort();
    const controller = (request.current = new AbortController());
    setState((s) => ({ url, reports: s.url === url ? s.reports : null, loading: true, error: false }));
    try {
      const res = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (!res.ok && !(again && res.status === 404)) throw new Error(String(res.status));
      const reports = res.ok ? ((await res.json()) as GroupReportsResponse).reports : [];
      if (!Array.isArray(reports) || reports.some((r) => !r || typeof r.id !== "string" || typeof r.title !== "string"
        || typeof r.source?.name !== "string" || typeof r.originalUrl !== "string" || !Number.isFinite(Date.parse(r.timelineAt)))) {
        throw new Error("Invalid group reports");
      }
      if (!controller.signal.aborted) setState({ url, reports, loading: false, error: false });
    } catch {
      if (!controller.signal.aborted) setState((s) => ({ ...s, loading: false, error: true }));
    }
  };
  const restore = (reports: GroupReport[] | null) => setState({ url, reports, loading: false, error: false });
  return { ...current, load, restore };
}

function Toggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="relative z-10 inline-flex items-center gap-0.5 text-ink-4 transition-colors hover:text-accent text-[12.5px]"
    >
      {children}
      <IconChevronDown size={13} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function Panel({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <Collapse open={open} className="relative z-10">
      <div className="mt-2 rounded-control bg-bg-sunk px-3 py-2 dark:bg-bg-muted/60">{children}</div>
    </Collapse>
  );
}

function LoadState({ loading, error, onRetry, empty }: { loading: boolean; error: boolean; onRetry: () => void; empty: boolean }) {
  if (loading && empty) return <div className="space-y-2 py-1">{[0, 1].map((i) => <div key={i} className="skeleton h-4" />)}</div>;
  if (error) return <button type="button" onClick={onRetry} className="min-h-11 py-1 text-[12.5px] text-hot lg:min-h-0"><Text>{empty ? "暂时无法加载，点此重试" : "更新失败，当前为上次内容，点此重试"}</Text></button>;
  if (!loading && empty) return <p role="status" className="py-1 text-[12.5px] text-ink-4"><Text>暂无其他可显示的报道</Text></p>;
  return null;
}

/** "另有 N 家信源报道": the other reports of the fact the card stands for, behind a toggle. */
export function GroupSources({ group, filters, parentId }: { group: GroupInfo; filters?: TimelineFilters; parentId: string }) {
  const translate = useText();
  const entry = useLocation().key;
  const key = `${group.scope ?? "fact"}|${group.factId}|${parentId}`;
  const saved = openGroups.peek(entry)?.groups[key];
  const [open, setOpen] = useState(saved !== undefined);
  const url = reportsUrl(group, filters);
  const reports = useReports(url, saved);
  // Back in this history entry, an open group comes back open and is read once more; so after the browser
  // reloaded the page on back/forward (never on a reader's reload, which asks for a fresh list).
  useEffect(() => {
    const inMemory = openGroups.peek(entry)?.groups[key];
    const restored = inMemory !== undefined ? inMemory : isReload() ? undefined : openGroups.read(entry)?.groups[key];
    if (restored === undefined) {
      if (open) void reports.load(true);
      return;
    }
    setOpen(true);
    reports.restore(restored);
    void reports.load(true);
  }, [entry, key, url]);
  useEffect(() => {
    remember(entry, key, open ? reports.reports : undefined);
  }, [entry, key, open, reports.reports]);
  const others = (reports.reports ?? []).filter((r) => r.id !== parentId);
  return (
    <div>
      <Toggle
        open={open}
        onToggle={() => {
          setOpen(!open);
          if (!open && !reports.reports && !reports.loading) void reports.load();
        }}
      >
        <Text>{labelOf(group)}</Text>
      </Toggle>
      <Panel open={open}>
        <ul className="divide-y divide-line-soft">
          {others.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 py-1.5 text-[13px]">
              <span className="w-[140px] shrink-0 text-ink-4">
                <span className="block truncate"><Text>{r.source.name}</Text></span>
                <time dateTime={r.timelineAt} className="num block text-[11px]"><Text>{monthDayTime(r.timelineAt)}</Text></time>
              </span>
              <Link viewTransition={routeViewTransition()} to={`/items/${r.id}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-accent">
                <Text content>{r.title}</Text>
              </Link>
              <a href={r.originalUrl} target="_blank" rel="noopener noreferrer" aria-label={translate("打开原文")} className="shrink-0 text-ink-4 hover:text-accent">
                <IconArrowUpRight size={13} />
              </a>
            </li>
          ))}
        </ul>
        <LoadState loading={reports.loading} error={reports.error} empty={others.length === 0} onRetry={() => reports.load()} />
      </Panel>
    </div>
  );
}

/** Phones: the same duplicate reports as the desktop expansion. */
export function GroupButton({ group, filters, parentId }: { group: GroupInfo; filters?: TimelineFilters; parentId: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMounted(true);
          setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative z-10 mt-2 flex min-h-11 w-full items-center justify-between rounded-tile bg-bg-sunk px-3 py-2 text-left text-[12.5px] text-ink-4 transition-colors active:bg-bg-muted lg:hidden dark:bg-bg-muted/60 dark:active:bg-bg-muted"
      >
        <Text>{labelOf(group)}</Text>
        <IconChevronRight size={14} />
      </button>
      {mounted && <GroupSheet open={open} onClose={() => setOpen(false)} group={group} filters={filters} parentId={parentId} />}
    </>
  );
}

function GroupSheet({ open, onClose, group, filters, parentId }: {
  open: boolean;
  onClose: () => void;
  group: GroupInfo;
  filters?: TimelineFilters;
  parentId: string;
}) {
  const translate = useText();
  const url = reportsUrl(group, filters);
  const reports = useReports(url);
  useEffect(() => {
    if (open) void reports.load(true);
  }, [open, url]);
  const others = (reports.reports ?? []).filter((r) => r.id !== parentId);
  return (
    <Sheet open={open} onClose={onClose} title={translate(group.scope === "story" ? "同一事件的进展与报道" : "同一新闻的其他报道")}>
      <div className="px-5">
        <ul className="divide-y divide-line-soft">
          {others.map((r) => (
            <li key={r.id} className="flex items-start gap-2 py-3">
              <Link viewTransition={routeViewTransition()} to={`/items/${r.id}`} className="min-w-0 flex-1 active:opacity-60">
                <span className="block text-[12.5px] text-ink-4">
                  <Text>{r.source.name}</Text> · <span className="num"><Text>{monthDayTime(r.timelineAt)}</Text></span>
                </span>
                <span className="mt-0.5 line-clamp-2 text-[15px] leading-[1.5] text-ink-2"><Text content>{r.title}</Text></span>
              </Link>
              <a href={r.originalUrl} target="_blank" rel="noopener noreferrer" aria-label={translate("打开原文")} className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-4 active:bg-bg-sunk">
                <IconArrowUpRight size={16} />
              </a>
            </li>
          ))}
        </ul>
        <div className="py-2">
          <LoadState loading={reports.loading} error={reports.error} empty={others.length === 0} onRetry={() => reports.load()} />
        </div>
      </div>
    </Sheet>
  );
}
