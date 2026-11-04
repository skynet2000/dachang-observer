import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { collectMaimai, postMaterial, topicSource, SOURCE_ID, NOTICE } from "../server.ts";
import type { SourceRow } from "@aihot/backend/sources/types";

const now = new Date();
const egid = "a".repeat(32);
const post = { id: "100123", egid, title: "测试互联网企业员工自述收到岗位调整通知", text: "我在测试互联网企业工作，今天收到岗位调整的协商通知，具体适用部门还不清楚。以上是个人经历，没有企业公告。", author_info: { name: "测试匿名用户", privateId: "do-not-store" }, publish_time: Math.floor(now.getTime()/1000), shareable: 1, ip_loc: "do-not-store", cmts: [{text:"Do not join comments"}] };
const topics = ["topicA", "topicB"].map(id => ({title:"测试互联网企业员工调整",url:`https://maimai.cn/n/content/global-topic?topic_id=${id}&share_euid=do-not-store`}));
const vagueTopic = { title: "最近这波变化大家怎么看", url: "https://maimai.cn/n/content/global-topic?topic_id=vague" };
let badTopic = false;
const server = http.createServer((req,res) => {
  if(req.url==="/rss") { res.setHeader("content-type","application/rss+xml");return res.end(`<rss version="2.0"><channel><title>test</title>${topics.map(t=>`<item><title>${t.title}</title><link>${t.url.replaceAll('&','&amp;')}</link></item>`).join("")}</channel></rss>`); }
  res.setHeader("content-type","text/html");
  res.end(badTopic ? '<h1>请登录后查看</h1>' : `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{topicFeeds:[post,{...post,id:"100124",publish_time:null},{...post,id:"100125",shareable:0}]}}})}</script>`);
});
const oldCollect=process.env.COLLECT_ENABLED;
before(async()=>{
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  config.allowPrivateNetworkFetch=true;
  await sql`INSERT INTO sources(id,name,kind,config,participation_mode,interval_minutes) VALUES
    ('rss-maimai-hot','Maimai leads','rss',${sql.json({ ingestNoiseFilter: { requireTitleAnyMatches: ["互联网", "腾讯"], requireAnyMatches: ["员工", "薪酬"] } })},'isolated',120),
    (${SOURCE_ID},'Maimai public posts','external',${sql.json({publicationNotice:NOTICE})},'editorial',30)`;
});
after(async()=>{ if(oldCollect===undefined)delete process.env.COLLECT_ENABLED;else process.env.COLLECT_ENABLED=oldCollect;await stopBoss();await closeDb();await new Promise<void>(r=>server.close(()=>r())); });
const base=()=>`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const readers={rss:((s,o)=>fetchRss({...s,config:{...s.config,feedUrl:base()+"/rss"}},o)) as typeof fetchRss,
  posts:((s)=>fetchJsonList({...s,config:{...s.config,url:base()+"/topic"}})) as typeof fetchJsonList};

test("the collection valve prevents every request",async()=>{
  process.env.COLLECT_ENABLED="false";
  assert.deepEqual(await collectMaimai({rss:async()=>{throw new Error("unexpected request");}}),{skipped:"collection-disabled"});
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

test("reads vaguely titled hot topics, keeps up to five relevant posts and survives a bridge error", async () => {
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const candidate = {
    title: "收到新通知", author: "测试用户", bodyText: "我在腾讯工作，今天收到新的薪酬调整通知，具体适用团队仍不清楚。",
    publishedAt: now, url: `https://maimai.cn/n/content/gossip-detail/100200?egid=${egid}&gid=100200`, raw: { externalId: "100200" },
  };
  const topicPosts = [
    { ...candidate, title: "午饭吃什么", bodyText: "今天和朋友出门吃了一顿饭，聊了一下假期出去旅行的计划。" },
    ...Array.from({ length: 6 }, (_, i) => {
      const id = String(100201 + i);
      return { ...candidate, url: `https://maimai.cn/n/content/gossip-detail/${id}?egid=${egid}&gid=${id}`, raw: { externalId: id } };
    }),
  ];
  const hotRss: typeof fetchRss = async (source, opts) => ({ ...await readers.rss(source, opts), candidates: [vagueTopic] });
  const result = await collectMaimai({ rss: hotRss, posts: async () => topicPosts });
  assert("created" in result);
  assert.equal(result.created, 5);
  assert.equal(result.rejected, 1);

  const errorRss: typeof fetchRss = async (source, opts) => ({
    ...await hotRss(source, opts),
    candidates: [{ title: "订阅源发生错误（RSS Error）", url: "https://decemberpei.cyou/rssbox/error" }],
  });
  await sql`UPDATE sources SET next_fetch_at=now() WHERE id=${SOURCE_ID}`;
  const cached = await collectMaimai({ rss: errorRss, posts: async () => topicPosts });
  assert("created" in cached);
  assert.equal(cached.created, 0);
  assert.equal(cached.topics, 1);
  assert.match(cached.rssError ?? "", /no valid hot-topic links/);

  await sql`UPDATE sources SET next_fetch_at=now(), cursor=jsonb_set(cursor, '{hotTopics,fetchedAt}', '0') WHERE id=${SOURCE_ID}`;
  await assert.rejects(collectMaimai({ rss: errorRss, posts: async () => { throw new Error("expired cache used"); } }), /no valid hot-topic links/);
});

test("a missing date, private post, future date and non-platform link never become publication material",async()=>{
  const draft=topicSource(topics[0]!,{} as SourceRow)!;
  badTopic=false;
  const candidates=await readers.posts(draft);
  assert.equal(candidates.length,2,"the non-shareable post is excluded by the JSON adapter");
  const lead=topics[0]!;const valid=candidates[0]!;
  assert(postMaterial(valid,lead,now));
  assert.equal(postMaterial(candidates[1]!,lead,now),null);
  assert.equal(postMaterial({...valid,publishedAt:new Date(now.getTime()+7200000)},lead,now),null);
  assert.equal(postMaterial({...valid,publishedAt:new Date(now.getTime()-8*86400000)},lead,now),null);
  assert.equal(postMaterial({...valid,url:"https://example.com/100123"},lead,now),null);
  assert.equal(topicSource({...lead,url:"https://example.com/?topic_id=x"},{} as SourceRow),null);
});
