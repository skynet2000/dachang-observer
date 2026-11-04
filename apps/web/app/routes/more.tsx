import { Text, useText } from "@aihot/web/lib/text";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { EDITORIAL, POLICY, SITE } from "@aihot/site";
import type { loader as rootLoader } from "../root";
import { useChangelogDot } from "../components/shell/Header";
import { PhoneBar } from "../components/shell/PhoneBar";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { edgeTtl } from "../lib/api.server";
import { webModules } from "../site-modules";
import { pageMeta } from "../lib/seo";
import { setFontPreference, useFontPreference, useStarred } from "../lib/local-state";
import { Select } from "../components/ui/Controls";
import { SectionTabTitle } from "../components/ui/Page";
import { ThemeSwitch } from "../components/shell/ThemeSwitch";
import { IconBookmark, IconUser, IconChevronRight, IconGrid, IconHeart, IconMessage, IconMoon, IconPlug, IconSparkles } from "../components/icons";

export const handle = { tab: "me", name: "我的" } satisfies Screen;

export function headers() {
  return edgeTtl(300);
}

export function meta() {
  return pageMeta({ title: handle.name, path: "/more", noindex: true, omitDocumentTitle: true });
}

/**
 * "我的", the phone's last tab (the address stays /more): this browser's bookmarks and appearance first,
 * then the tools, then the site's own pages.
 */
type Row = { to: string; label: string; icon: ReactNode; detail?: ReactNode };

/** The ways in that the agent page offers, the modules' first; its row names the first three. */
const agentWays = () => [...webModules().flatMap((m) => m.agentWays ?? []), "MCP", "RSS", "API"];

/** The modules' tools first, then the engine's. */
const tools = (): Row[] => [
  ...webModules().flatMap((m) => m.tools ?? []),
  ...(inNav("/topics") ? [{ to: "/topics", label: "主题", icon: <IconGrid size={20} /> }] : []),
  { to: "/agent", label: "Agent 接入", icon: <IconPlug size={20} />, detail: agentWays().slice(0, 3).join(" · ") },
];

function Group({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {title && <h2 className="px-4 pb-2 pt-6 text-[13px] font-semibold text-ink-3"><Text>{title}</Text></h2>}
      <ul className="card divide-y divide-line-soft overflow-hidden">{children}</ul>
    </section>
  );
}

function RowLink({ row, dot = false }: { row: Row; dot?: boolean }) {
  const translate = useText();
  return (
    <li>
      <Link viewTransition to={row.to} className="flex min-h-[52px] items-center gap-3 px-4 text-[16px] font-medium text-ink transition-colors active:bg-bg-sunk">
        <span className="shrink-0 text-ink-3"><Text>{row.icon}</Text></span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Text>{row.label}</Text>
          {dot && <span className="size-[7px] rounded-full bg-hot" aria-label={translate("有新的更新")} />}
        </span>
        {row.detail && <span className="max-w-[45%] text-right text-[14px] font-normal text-ink-4"><Text>{row.detail}</Text></span>}
        <IconChevronRight size={16} className="shrink-0 text-ink-4" />
      </Link>
    </li>
  );
}

export default function MorePage() {
  const translate = useText();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const changelogDot = useChangelogDot(root?.changelogVersion ?? null);
  const starred = useStarred();
  const font = useFontPreference();
  // The count is this browser's: shown once the page runs here, never in the shared server copy.
  const [here, setHere] = useState(false);
  useEffect(() => setHere(true), []);
  const help: Row[] = [
    ...(inNav("/about") ? [{ to: "/about", label: `关于 ${SITE.name}`, icon: <IconHeart size={20} /> }] : []),
    ...(inNav("/changelog") ? [{ to: "/changelog", label: "更新日志", icon: <IconSparkles size={20} /> }] : []),
    { to: "/feedback", label: "意见反馈", icon: <IconMessage size={20} /> },
  ];
  const fontControl = <Select className="min-w-0 max-w-[65%] lg:max-w-[220px] lg:[&_select]:h-[34px] lg:[&_select]:text-[14px]" aria-label={translate("字体")} value={font ?? "system"} onChange={(e) => setFontPreference(e.target.value === "browser" ? "browser" : null)}>
    <option value="system"><Text>默认字体</Text></option>
    <option value="browser"><Text>浏览器默认字体</Text></option>
  </Select>;
  return (
    <div className="personal-settings mx-auto max-w-[var(--page-max-reading)] pb-8 lg:max-w-[640px] lg:pt-3">
      <SectionTabTitle label={handle.name} />
      <PhoneBar title={translate("我的")} large />
      <div className="hidden lg:block">
        <h1 className="mb-7 text-[28px] font-bold tracking-[-0.03em] text-ink"><Text>我的</Text></h1>
        <div className="personal-settings-list">
          <Group title="账号与收藏">
            <RowLink row={{ to: "/account", label: "读者账号", icon: <IconUser size={20} />, detail: translate("收藏与已读") }} />
            <RowLink row={{ to: "/starred", label: "收藏", icon: <IconBookmark size={20} /> }} />
          </Group>
          <Group title="阅读偏好">
            <li className="flex min-h-[59px] items-center gap-3 text-[15px] font-medium text-ink">
              <IconMoon size={20} className="shrink-0 text-ink-3" />
              <span className="flex-1"><Text>外观</Text></span>
              <ThemeSwitch labels className="w-[230px] max-w-[65%]" />
            </li>
            <li className="flex min-h-[59px] items-center gap-3 text-[15px] font-medium text-ink">
              <span className="w-5 shrink-0 text-center text-ink-3" aria-hidden="true">Aa</span>
              <span className="flex-1"><Text>字体</Text></span>
              {fontControl}
            </li>
          </Group>
          <Group title="工具与帮助">
            {[...tools(), ...help].map(r => <RowLink key={r.to} row={r} dot={r.to === "/changelog" && changelogDot} />)}
          </Group>
        </div>
      </div>
      <div className="lg:hidden">
        <Group title="阅读与偏好">
          <RowLink row={{ to: "/account", label: "读者账号", icon: <IconUser size={20} />, detail: translate("收藏与已读") }} />
          <RowLink row={{ to: "/starred", label: "收藏", icon: <IconBookmark size={20} />, detail: here && starred.length > 0 ? <span className="num"><Text>{starred.length}</Text></span> : undefined }} />
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="text-ink-3">
              <IconMoon size={20} />
            </span>
            <span className="flex-1"><Text>外观</Text></span>
            <ThemeSwitch className="w-[126px]" />
          </li>
          <li className="flex min-h-[56px] items-center gap-3 px-4 text-[16px] font-medium text-ink">
            <span className="w-5 text-center text-ink-3" aria-hidden="true">Aa</span>
            <span className="flex-1"><Text>字体</Text></span>
            {fontControl}
          </li>
        </Group>
        <Group title="工具与入口">
          {tools().map((r) => (
            <RowLink key={r.to} row={r} />
          ))}
        </Group>
        <Group title="帮助与反馈">
          {help.map(r => <RowLink key={r.to} row={r} dot={r.to === "/changelog" && changelogDot} />)}
        </Group>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] leading-[2] text-ink-4 lg:justify-start">
        <Link viewTransition to="/terms" className="hover:text-ink-2"><Text>{POLICY.terms.name}</Text></Link>
        <Link viewTransition to="/privacy" className="hover:text-ink-2"><Text>隐私说明</Text></Link>
        <a href={EDITORIAL.selectionEnabled ? "/feed.xml" : "/feed/all.xml"} className="hover:text-ink-2">RSS</a>
        {SITE.github && <a href={SITE.github} target="_blank" rel="noopener noreferrer" className="hover:text-ink-2"><Text>GitHub 开源</Text></a>}
        {SITE.icp && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-2"><Text>{SITE.icp}</Text></a>}
      </div>
    </div>
  );
}
