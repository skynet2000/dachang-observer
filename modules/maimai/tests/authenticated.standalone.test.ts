import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHotRank, parseSearchPage, searchPostTimes } from "../authenticated.ts";

test("extracts only the hot topic list from a Flight payload containing personalized posts", () => {
  const rows = ["abc", "def", "ghi"].map((id, i) => ({
    id, type: 9, name: `测试话题${i}`, schema: `taoumaimai://rct?component=GossipGlobalTopicList&topic_id=${id}&circle_type=9`,
  }));
  const payload = `0:${JSON.stringify({ listDefault: [{ id: "private-post" }], data: rows })}`;
  const html = `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
  const result = parseHotRank(html);
  assert.equal(result.length, 3);
  assert.equal(result[0]?.url, "https://maimai.cn/n/content/global-topic?circle_type=9&topic_id=abc");
  assert(!JSON.stringify(result).includes("private-post"));
  assert.throws(() => parseHotRank("<html>登录</html>"), /hot-topic list not found/);
});

test("accepts only matching post IDs and exact valid Beijing wall-clock times", () => {
  const data = { data: { gossips: [
    { gid: 123, gossip: { id: 123, crtime: "2026-11-05 08:30:00" } },
    { gid: 124, gossip: { id: 999, crtime: "2026-11-05 08:30:00" } },
    { gid: 125, gossip: { id: 125, crtime: "2小时前" } },
    { gid: 126, gossip: { id: 126, crtime: "2026-02-30 08:30:00" } },
  ] } };
  const times = searchPostTimes(data);
  assert.equal(times.size, 1);
  assert.equal(times.get("123")?.toISOString(), "2026-11-05T00:30:00.000Z");
  assert.equal(searchPostTimes({ result: "error" }).size, 0);
  const html = `<script>var share_data = JSON.parse(${JSON.stringify(JSON.stringify(data))});</script>`;
  assert.equal(parseSearchPage(html).get("123")?.toISOString(), "2026-11-05T00:30:00.000Z");
  assert.throws(() => parseSearchPage("<html>请登录</html>"), /invalid data/);
});
