import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { collectPublicLeads, publicBackupHotTopics, publicHotTopics, publicLead, readPublicLeads } from "../modules/maimai/public-leads.ts";
import type { TopicPost } from "../modules/maimai/authenticated.ts";

after(closeDb);
const topic = "https://maimai.cn/n/content/global-topic?circle_type=9&topic_id=test";
const post = (id="123"): TopicPost => ({ url:`https://maimai.cn/n/content/gossip-detail/${id}?egid=${"a".repeat(32)}&gid=${id}`,
  title:"腾讯绩效和年终奖讨论", bodyText:"腾讯员工讨论绩效和年终奖，具体情况还需要核实。",likes:5,comments:0,publishedAt:null });

test("public leads require valid share links, workplace scope and observed interaction; missing dates stay missing", () => {
  assert.equal(publicLead(post(),topic)?.publishedAt,null);
  assert.ok(publicLead({...post(),likes:0,comments:5},topic));
  assert.equal(publicLead({...post(),bodyText:"腾讯员工绩效讨论。".repeat(100)},topic)?.excerpt.length,240);
  for (const change of [{likes:4,comments:4},{likes:NaN},{url:"invalid"},{url:"https://evil.example/n/content/gossip-detail/123?gid=123"},
    {url:post().url.replace("gid=123","gid=999")},{title:"吃饭推荐",bodyText:"周末去哪里吃饭？"},
    {publishedAt:new Date(Date.now()-8*86400000)},{publishedAt:new Date(Date.now()+60000)}]) {
    assert.equal(publicLead({...post(),...change},topic),null);
  }
});

test("HTTP-success placeholders and nonofficial topic links cannot become a hot rank",()=>{
  assert.throws(()=>publicHotTopics("<rss><channel><item><title>error</title></item></channel></rss>"));
  const xml=(ids:string[],origin="https://maimai.cn")=>`<rss><channel>${ids.map(id=>`<item><link>${origin}/n/content/global-topic?topic_id=${id}</link></item>`).join("")}</channel></rss>`;
  assert.throws(()=>publicHotTopics(xml(["one","two","three"],"https://evil.example")));
  assert.throws(()=>publicHotTopics(xml(["same","same","same"])));
  assert.equal(publicHotTopics(xml(Array.from({length:20},(_,i)=>String(i)))).length,15);
});

test("backup hot list requires recent data and official distinct topic links",()=>{
  const now=Date.now();
  const data={code:200,updateTime:new Date(now-3600000).toISOString(),data:["one","two","three"].map(id=>({url:`https://maimai.cn/n/content/global-topic?topic_id=${id}`}))};
  assert.equal(publicBackupHotTopics(data,now).length,3);
  assert.throws(()=>publicBackupHotTopics({...data,updateTime:new Date(now-5*3600000).toISOString()},now));
  assert.throws(()=>publicBackupHotTopics({...data,data:[{url:"https://evil.example/n/content/global-topic?topic_id=one"}]},now));
  assert.throws(()=>publicBackupHotTopics({...data,code:500},now));
});

test("public collection is independent from publications and preserves discovery time and moderation",async()=>{
  process.env.COLLECT_ENABLED="false";
  assert.deepEqual(await collectPublicLeads({topics:async()=>{throw new Error("must not fetch");}}),{skipped:true});
  process.env.COLLECT_ENABLED="true";
  const posts=async (_topic:string,view: string,cookie?: string|null)=>{
    assert.equal(view,"share");assert.equal(cookie,null);
    return [post(),post("456"),{...post("789"),likes:1}];
  };
  try {
    const result=await collectPublicLeads({topics:async()=>[topic],posts});
    assert.equal(result.found,3);assert.equal(result.kept,2);
    let data=await readPublicLeads();assert.equal(data.items.length,2);assert.equal(data.status.ok,true);
    assert.equal(data.items[0].topicUrl,topic);
    const first=data.items.find(i=>i.id==="123")!.firstSeenAt;
    await sql`UPDATE maimai_public_leads SET visible=false WHERE post_id='456'`;
    await collectPublicLeads({topics:async()=>[topic],posts});
    data=await readPublicLeads();assert.equal(data.items.length,1);assert.equal(+data.items[0].firstSeenAt,+first);
    assert.equal(data.items[0].publishedAt,null);
    assert.equal((await sql`SELECT 1 FROM articles WHERE url LIKE 'https://maimai.cn/%'`).length,0);
    assert.equal((await sql`SELECT 1 FROM publications WHERE url LIKE 'https://maimai.cn/%'`).length,0);
    await assert.rejects(collectPublicLeads({topics:async()=>{throw new Error("public feed unavailable");}}));
    assert.equal((await readPublicLeads()).status.ok,false);
    await collectPublicLeads({topics:async()=>[topic],posts:async()=>[]});
    assert.equal((await readPublicLeads()).status.ok,true);
    await sql`UPDATE maimai_public_leads SET last_seen_at=now()-interval '3 days'`;
    assert.equal((await readPublicLeads()).items.length,0);
  } finally { process.env.COLLECT_ENABLED="false"; }
});
