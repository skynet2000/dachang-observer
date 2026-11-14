import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import type { PoolResponse } from "@aihot/contracts/site";
import { Text } from "../../lib/text";
import { filterParams, listPath } from "../../lib/seo";

function fingerprint(data: PoolResponse) {
  return JSON.stringify([data.total, data.items.map(item => [item.id, item.anchorAt, item.title])]);
}

export function FeedUpdateNotice({ data }: { data: PoolResponse }) {
  const [available, setAvailable] = useState(false);
  const revalidator = useRevalidator();
  const baseline = fingerprint(data);
  const path = listPath("/api/site/pool", {
    ...filterParams(data.filters), q: data.filters.q, tab: data.filters.tab,
    page: data.page > 1 ? data.page : null,
  });
  useEffect(() => {
    setAvailable(false);
    const controller = new AbortController();
    let checking = false, checkedAt = 0;
    const check = async () => {
      if (document.visibilityState === "hidden" || checking || Date.now() - checkedAt < 60_000) return;
      checking = true;
      checkedAt = Date.now();
      try {
        const response = await fetch(path, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) return;
        const next = await response.json() as PoolResponse;
        if (!controller.signal.aborted && Array.isArray(next.items) && Number.isFinite(next.total)) setAvailable(fingerprint(next) !== baseline);
      } catch { /* Keep the current readable feed when the check fails. */ }
      finally { checking = false; }
    };
    const timer = setInterval(check, 5 * 60_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [path, baseline]);
  if (!available) return null;
  return <aside role="status" className="fixed bottom-24 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-lg lg:bottom-5">
    <span><Text>资讯已更新</Text></span>
    <button type="button" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()} className="whitespace-nowrap font-semibold text-accent"><Text>刷新查看</Text></button>
  </aside>;
}
