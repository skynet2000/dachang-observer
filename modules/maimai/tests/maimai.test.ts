import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectMaimai, postMaterial, SOURCE_ID, NOTICE } from "../server.ts";
import { parseTopicPosts, type TopicView } from "../authenticated.ts";

const now = new Date();
const egid = "a".repeat(32);
const post = { id: "100123", egid, title: "测试互联网企业员工自述收到岗位调整通知", text: "我在测试互联网企业工作，今天收到岗位调整的协商通知，具体适用部门还不清楚。以上是个人经历，没有企业公告。", author_info: { name: "测试匿名用户", privateId: "do-not-store" }, publish_time: Math.floor(now.getTime()/1000), shareable: 1, likes: 10, ip_loc: "do-not-store", cmts: [{text:"Do not join comments"}] };
const topics = ["topicA", "topicB"].map(id => ({title:"测试互联网企业员工调整",url:`https://maimai.cn/n/content/global-topic?topic_id=${id}&share_euid=do-not-store`}));
const vagueTopic = { title: "最近这波变化大家怎么看", url: "https://maimai.cn/n/content/global-topic?topic_id=vague" };
let badTopic = false;
function topicPage(view: TopicView): string {
  if (badTopic) return '<h1>请登录后查看</h1>';
  const rows = [post, {...post,id:"100124",publish_time:null},{...post,id:"100125",shareable:0}];
  if (view === "share") return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{topicFeeds:rows}}})}</script>`;
  return `<script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify({ listDefault: rows })}`])})</script>`;
}
const oldCollect=process.env.COLLECT_ENABLED;
const oldCookie=process.env.MAIMAI_COOKIE;
before(async()=>{
  process.env.MAIMAI_COOKIE = "test-cookie";
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode,interval_minutes) VALUES
    (${SOURCE_ID},'Maimai public posts','external',${sql.json({publicationNotice:NOTICE})},'editorial',30)`;
});
after(async()=>{ if(oldCollect===undefined)delete process.env.COLLECT_ENABLED;else process.env.COLLECT_ENABLED=oldCollect;if(oldCookie===undefined)delete process.env.MAIMAI_COOKIE;else process.env.MAIMAI_COOKIE=oldCookie;await stopBoss();await closeDb(); });
const readers={rank: async () => topics, times: async () => new Map<string, Date>(),
  posts: async (_url: string, view: TopicView) => parseTopicPosts(topicPage(view), view)};

test("the collection valve prevents every request",async()=>{
  process.env.COLLECT_ENABLED="false";
  assert.deepEqual(await collectMaimai({rank:async()=>{throw new Error("unexpected request");}}),{skipped:"collection-disabled"});
});

test("topic extraction preserves precise original time and deduplicates a post across hot topics without retaining profile data",async()=>{
  process.env.COLLECT_ENABLED="true";
  const result=await collectMaimai(readers);
  assert('created' in result);
  assert.equal(result.created,1);assert.equal(result.revised,0);
  const rows=await sql`SELECT * FROM articles WHERE source_id=${SOURCE_ID}`;
  assert.equal(rows.length,1);
  assert.equal(rows[0]!.identity_key,"maimai:post:100123");
  assert.equal(rows[0]!.published_at.toISOString(),new Date(post.publish_time*1000).toISOString());
  assert.equal(rows[0]!.url,`https://maimai.cn/n/content/gossip-detail/100123?egid=${egid}&gid=100123`);
  assert.equal(rows[0]!.body_status,"ok");
  assert(!JSON.stringify(rows[0]).includes("do-not-store"));assert(!rows[0]!.body_text.includes("Do not join comments"));
  const [schedule] = await sql`SELECT next_fetch_at - last_fetch_at = interval '30 minutes' AS on_time FROM sources WHERE id=${SOURCE_ID}`;
  assert.equal(schedule!.on_time, true);
  assert.deepEqual(await collectMaimai(readers),{skipped:"not-due"});
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const again=await collectMaimai(readers);assert('created' in again);assert.equal(again.created,0);assert.equal(again.revised,0);
});

test("login or missing post data is a recorded failure, never a healthy empty topic",async()=>{
  process.env.COLLECT_ENABLED="true";badTopic=true;
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  await assert.rejects(collectMaimai(readers),/topicFeeds/);
  const [source]=await sql`SELECT health,fail_count, next_fetch_at - last_fetch_at = interval '60 minutes' AS on_time FROM sources WHERE id=${SOURCE_ID}`;
  assert.equal(source!.health,"degraded");assert.equal(source!.fail_count,1);assert.equal(source!.on_time,true);
  const [run]=await sql`SELECT status FROM fetch_runs WHERE source_id=${SOURCE_ID} ORDER BY id DESC LIMIT 1`;
  assert.equal(run!.status,"failed");
  await sql`UPDATE sources SET fail_count=5, next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  await assert.rejects(collectMaimai(readers),/topicFeeds/);
  const [capped] = await sql`SELECT next_fetch_at - last_fetch_at = interval '120 minutes' AS capped FROM sources WHERE id=${SOURCE_ID}`;
  assert.equal(capped!.capped, true);
});

test("reads vaguely titled hot topics, keeps up to five relevant posts and reports a rank outage even with cached topics", async () => {
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const candidate = {
    title: "收到新通知", author: "测试用户", bodyText: "我在腾讯工作，今天收到新的薪酬调整通知，具体适用团队仍不清楚。",
    publishedAt: now, url: `https://maimai.cn/n/content/gossip-detail/100200?egid=${egid}&gid=100200`, raw: { externalId: "100200" }, likes: 10, comments: 0,
  };
  const topicPosts = [
    { ...candidate, title: "午饭吃什么", bodyText: "今天和朋友出门吃了一顿饭，聊了一下假期出去旅行的计划。" },
    { ...candidate, url: `https://maimai.cn/n/content/gossip-detail/100299?egid=${egid}&gid=100299`, raw: { externalId: "100299" }, likes: 1 },
    ...Array.from({ length: 6 }, (_, i) => {
      const id = String(100201 + i);
      return { ...candidate, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, raw: { externalId: id }, likes: 10, comments: 0 };
    }),
  ];
  const hotRank = async () => [vagueTopic];
  const result = await collectMaimai({ ...readers, rank: hotRank, posts: async () => topicPosts });
  assert("created" in result);
  assert.equal(result.created, 5);
  assert.equal(result.relevant, 7);
  assert.equal(result.highHeat, 6);
  const [lowHeat] = await sql`SELECT id FROM articles WHERE identity_key='maimai:post:100299'`;
  assert.equal(lowHeat, undefined);

  const unavailable = async () => { throw new Error("hot rank unavailable"); };
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  await assert.rejects(collectMaimai({ ...readers, rank: unavailable, posts: async () => topicPosts }), /used cached topics/);

  await sql`UPDATE sources SET next_fetch_at=now(), cursor=jsonb_set(cursor, '{hotTopics,fetchedAt}', '0') WHERE id=${SOURCE_ID}`;
  await assert.rejects(collectMaimai({ ...readers, rank: unavailable, posts: async () => { throw new Error("expired cache used"); } }), /^Error: hot rank unavailable$/);
});

test("a missing date, private post, future date and non-platform link never become publication material",async()=>{
  badTopic=false;
  const candidates=await readers.posts(topics[0]!.url, "share");
  assert.equal(candidates.length,2,"the non-shareable post is excluded by the JSON adapter");
  const lead=topics[0]!;const valid=candidates[0]!;
  assert(postMaterial(valid,lead,now));
  assert.equal(postMaterial(candidates[1]!,lead,now),null);
  assert.equal(postMaterial({...valid,publishedAt:new Date(now.getTime()+7200000)},lead,now),null);
  assert.equal(postMaterial({...valid,publishedAt:new Date(now.getTime()-8*86400000)},lead,now),null);
  assert.equal(postMaterial({...valid,url:"https://example.com/100123"},lead,now),null);
});

test("readable topics with missing publication times fail visibly and create no posts", async () => {
  process.env.COLLECT_ENABLED = "true";
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const missing = { ...post, id: "100999", publish_time: null };
  const candidates = await readers.posts(topics[0]!.url, "share");
  const missingCandidate = { ...candidates[0]!, url: `https://maimai.cn/n/content/gossip-detail/${missing.id}?egid=${egid}&gid=${missing.id}`,
    publishedAt: null, raw: { externalId: missing.id } };
  await assert.rejects(collectMaimai({ ...readers, posts: async () => [missingCandidate] }), /no usable publication times/);
  const [run] = await sql`SELECT status,detail FROM fetch_runs WHERE source_id=${SOURCE_ID} ORDER BY id DESC LIMIT 1`;
  assert.equal(run!.status, "failed");
  assert.equal(run!.detail.missingDates, 1);
  const [count] = await sql`SELECT count(*)::int AS count FROM articles WHERE identity_key=${`maimai:post:${missing.id}`}`;
  assert.equal(count!.count, 0);
});

test("a post-specific lookup supplies exact time and a repeat run reuses the stored result", async () => {
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const lead = { title: "腾讯员工薪酬调整", url: "https://maimai.cn/n/content/global-topic?topic_id=topicC" };
  const id = "101234";
  const candidate = { title: "腾讯员工收到薪酬调整通知", author: "测试用户", bodyText: "我在腾讯工作，今天收到薪酬调整通知，具体适用团队仍不清楚。",
    publishedAt: null, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, raw: { externalId: id }, likes: 10, comments: 0 };
  const queries: string[] = [];
  const direct = { rank: async () => [lead], posts: async () => [candidate], times: async (_cookie: string, query: string) => {
    queries.push(query);
    return new Map([[id, now]]);
  } };
  const result = await collectMaimai(direct);
  assert("created" in result);
  assert.equal(result.created, 1);
  assert.deepEqual(queries, [candidate.title]);
  const [article] = await sql`SELECT published_at FROM articles WHERE identity_key=${`maimai:post:${id}`}`;
  assert.equal(article!.published_at.toISOString(), now.toISOString());
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const repeat = await collectMaimai(direct);
  assert("created" in repeat);
  assert.equal(repeat.created, 0);
  assert.equal(repeat.dateLookups, 0);
  assert.deepEqual(queries, [candidate.title]);
});

test("an all-missing round advances the bounded search to later posts", async () => {
  const lead = { title: "腾讯员工薪酬调整", url: "https://maimai.cn/n/content/global-topic?topic_id=topicD" };
  const batch = Array.from({ length: 25 }, (_, i) => {
    const id = String(200000 + i);
    return { title: `第${i}条腾讯员工薪酬调整`, author: "测试用户", bodyText: "我在腾讯工作，今天收到薪酬调整通知，具体适用团队仍不清楚。",
      publishedAt: null, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, raw: { externalId: id }, likes: 10, comments: 0 };
  });
  let calls = 0;
  const direct = { rank: async () => [lead], posts: async () => batch, times: async (_cookie: string, query: string) => {
    calls++;
    return new Map(query === batch[24]!.title ? [[batch[24]!.raw.externalId, now]] : []);
  } };
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  await assert.rejects(collectMaimai(direct), /no usable publication times/);
  assert.equal(calls, 24);
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const next = await collectMaimai(direct);
  assert("created" in next);
  assert.equal(next.created, 1);
  assert.equal(next.missingDates, 24);
});

test("a high-heat post from the latest view is collected and duplicate views preserve the exact time", async () => {
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const shared = { ...post, id: "300101", likes: 0 };
  const latest = [
    { ...shared, publish_time: null, cmts: 5 },
    { ...post, id: "300102", likes: 12 },
    { ...post, id: "300103", likes: 2 },
  ];
  const result = await collectMaimai({
    ...readers, rank: async () => [topics[0]!],
    posts: async (_url, view) => {
      const html = view === "share"
        ? `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { topicFeeds: [shared] } } })}</script>`
        : `<script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify({ listDefault: latest })}`])})</script>`;
      return parseTopicPosts(html, view);
    },
  });
  assert("created" in result);
  assert.equal(result.uniquePosts, 3);
  assert.equal(result.latestOnly, 2);
  assert.equal(result.highHeat, 2);
  assert.equal(result.created, 2);
  assert.equal(result.dateLookups, 0);
  const rows = await sql`SELECT identity_key,published_at FROM articles WHERE identity_key LIKE 'maimai:post:30010%' ORDER BY identity_key`;
  assert.deepEqual(rows.map(row => row.identity_key), ["maimai:post:300101", "maimai:post:300102"]);
  assert.equal(rows[0]!.published_at.toISOString(), new Date(post.publish_time * 1000).toISOString());
});
