import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let failed=false;
const api=createServer((req,res)=>{
  const p=new URL(req.url!,"http://local").pathname;
  res.setHeader("Content-Type","application/json");
  if(p==="/api/maimai/leads")return res.end(JSON.stringify({status:{ok:!failed,checkedAt:new Date().toISOString()},items:failed?[]:[{
    id:"123",url:"https://maimai.cn/n/content/gossip-detail/123?egid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&gid=123",
    title:"腾讯绩效与年终奖讨论",excerpt:"用户原帖，仅作线索。",likes:5,comments:7,publishedAt:null,
    firstSeenAt:"2026-11-14T01:00:00Z",lastSeenAt:new Date().toISOString()}]}));
  if(p==="/api/reader/session")return res.end(JSON.stringify({enabled:false,providers:[],user:null}));
  if(p==="/api/language/texts")return res.end(JSON.stringify({translations:[]}));
  if(p==="/api/site/meta")return res.end(JSON.stringify({changelogVersion:"fixture"}));
  if(p==="/api/health")return res.end("{}");
  res.statusCode=404;res.end("{}");
});
let web:WebServer,browser:Browser;
before(async()=>{web=await startWebServer(api);browser=await chromium.launch({channel:"chromium"});});
after(async()=>{await browser?.close();await web?.stop();});
for(const width of [390,1440])test(`public leads separate unknown publication time from discovery at ${width}px`,async()=>{
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  try {
    await page.goto(web.origin+"/workplace-leads");
    await expect(page.getByRole("heading",{level:1,name:"职场热议线索"})).toBeVisible();
    await expect(page.locator("article").getByText("发布时间未核实",{exact:true})).toBeVisible();
    await expect(page.locator("article").getByText(/发现时间（北京时间）/)).toBeVisible();
    assert.match(await page.locator('meta[name="robots"]').getAttribute("content")??"",/noindex/);
    assert.match(await page.getByRole("link",{name:"查看原帖"}).getAttribute("rel")??"",/nofollow/);
    await expect(page.locator("article p").filter({hasText:"用户原帖，仅作线索。"})).toBeHidden();
    await page.getByText("展开原帖摘录",{exact:true}).click();
    await expect(page.locator("article p").filter({hasText:"用户原帖，仅作线索。"})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole("button",{name:"Switch to English",exact:true}).click();
    await expect(page.locator("article").getByText("Publication time unverified",{exact:true})).toBeVisible();
  } finally { await context.close(); }
});
test("failed discovery never presents an empty day as confirmed quiet",async()=>{
  failed=true;
  const context=await browser.newContext(),page=await context.newPage();
  try {
    await page.goto(web.origin+"/workplace-leads");
    await expect(page.getByRole("status")).toContainText("部分公开入口读取失败，当前列表可能不完整。");
    await expect(page.getByText(/不能据此判断当天没有职场讨论/)).toBeVisible();
  } finally {failed=false;await context.close();}
});
