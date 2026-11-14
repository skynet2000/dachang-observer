import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { coverageSnapshot } from "../site/modules/coverage.ts";

after(closeDb);
test("a quiet section distinguishes successful rejection, missing collection, source failures, backlog and unclassified publications", async () => {
  const start=new Date(Date.now()-3600000), end=new Date(Date.now()+60000);
  await sql`INSERT INTO sources(id,name,kind,health,last_ok_at) VALUES('coverage-test','Coverage','rss','ok',now())`;
  const jobs=async()=> (await coverageSnapshot(start,end)).sections.find(s=>s.key==="jobs")!;
  assert.match((await jobs()).status,/没有成功采集/);
  await sql`INSERT INTO fetch_runs(source_id,status,finished_at) VALUES('coverage-test','ok',now())`;
  assert.match((await jobs()).status,/暂未发现合格新稿/);
  await sql`INSERT INTO sources(id,name,kind,created_at) VALUES('push-only','Push only','external',now()-interval '1 day')`;
  assert.match((await jobs()).status,/暂未发现合格新稿/);
  const item=await upsertMaterial({sourceId:"coverage-test",url:"https://example.org/coverage",title:"招聘观察",via:"fetch"});
  await sql`UPDATE articles SET processing_state='blocked' WHERE id=${item.articleId}`;
  assert.match((await jobs()).status,/暂未发现合格新稿/);
  await sql`UPDATE sources SET health='failing' WHERE id='coverage-test'`;
  assert.match((await jobs()).status,/采集覆盖不完整/);
  await sql`UPDATE sources SET health='ok' WHERE id='coverage-test'`;
  await sql`UPDATE articles SET processing_state='new',discovered_at=now()-interval '3 hours' WHERE id=${item.articleId}`;
  assert.match((await jobs()).status,/处理积压/);
  await sql`UPDATE articles SET processing_state='analyzed' WHERE id=${item.articleId}`;
  await sql`INSERT INTO publications(article_id,source_id,title,channel,url,eligible,discovered_at,timeline_at,published_at,sort_at)
    VALUES(${item.articleId},'coverage-test','招聘观察','news','https://example.org/coverage',true,now(),now(),now(),now())`;
  assert.match((await jobs()).status,/未分类职场稿/);
  await sql`UPDATE publications SET category='jobs' WHERE article_id=${item.articleId}`;
  assert.equal((await jobs()).published,1);
  assert.equal((await jobs()).status,"已有合格新稿");
});
