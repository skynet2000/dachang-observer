// Reduced titles from the public hotlist reviewed on 2026-10-26; no external requests.
import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import scope from "../modules/maimai/scope.json" with { type: "json" };
import { noiseFiltered } from "@aihot/backend/sources/filters";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import type { SourceRow } from "@aihot/backend/sources/types";

const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
const source: SourceRow & { site_fulltext: boolean; syndicate_fulltext: boolean; signal_group_id: string } = {
  cursor: null, fail_count: 0, first_party: false, ...pack.sources.find((s: SourceRow) => s.id === "external-maimai-posts"),
};
const titles = [
  "字节商业化GenAI负责人文石磊离职",
  "小米员工住宅开盘，共建4栋楼297套住房",
  "TikTok电商负责人陈熙离职",
  "曝米哈游、拳头、猩球游戏疯狂在广州抢人",
  "大众拟2030年前再裁1.2万人",
  "老干妈引入AI后裁员500余人引争议",
  "知名具身智能公司被曝欠薪停工，老板失联",
  "Kimi就K3.1 Pro限流致歉并补偿",
];
test("Maimai leads require an internet employer and a workplace topic; service refunds are excluded", () => {
  assertSupportedConfig(source.kind, source.config);
  const filter = { ...source, config: { ingestNoiseFilter: scope } };
  const filtered = (title: string, excerpt?: string) => noiseFiltered({ title, excerpt, url: "https://maimai.cn/n/content/global-topic?topic_id=lead" }, filter);
  assert.deepEqual(titles.filter(title => !filtered(title)), titles.slice(0, 4));
  assert(filtered("普通企业薪酬传闻", "字节员工讨论"), "a company in the excerpt cannot admit an unnamed headline");
  assert(!filtered("某大厂员工讨论薪酬变化"));
});

test("Maimai uses the direct post source without full-text redistribution or a bridge", () => {
  assert.equal(source.kind, "external");
  assert.equal(source.interval_minutes, 30);
  assert.equal(source.site_fulltext, false);
  assert.equal(source.syndicate_fulltext, false);
  assert.equal(source.signal_group_id, "community-maimai");
  assert(!pack.sources.some((s: SourceRow) => s.id === "rss-maimai-hot"));
});
