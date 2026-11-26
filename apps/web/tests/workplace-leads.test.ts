import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let failed=false;
let quiet=false;
const api=createServer((req,res)=>{
  const url=new URL(req.url!,"http://local");
  const p=url.pathname;
  res.setHeader("Content-Type","application/json");
  if(p==="/api/maimai/leads" && url.searchParams.get("view")==="history") {
    const page=Number(url.searchParams.get("page")??1);
    return res.end(JSON.stringify({status:null,page,pageCount:2,items:[{
      id:String(page),url:`https://maimai.cn/n/content/gossip-detail/${page}`,
      title:page===1?"存档的招聘冻结讨论":"第二页的团队缩编讨论",excerpt:"原帖，仅作线索。",likes:6,comments:3,
      publishedAt:page===2?"2026-11-05T01:00:00Z":null,
      firstSeenAt:"2026-11-05T02:00:00Z",lastSeenAt:"2026-11-05T03:00:00Z"
    }]}));
  }
  if(p==="/api/maimai/leads")return res.end(JSON.stringify({status:{ok:!failed,checkedAt:new Date().toISOString(),
    lastNewAt:quiet?new Date(Date.now()-25*3600000).toISOString():undefined},items:failed?[]:[{
    id:"123",url:"https://maimai.cn/n/content/gossip-detail/123?egid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&gid=123",
    topicUrl:"https://maimai.cn/hot/topic/1",
    title:"腾讯绩效与年终奖讨论",excerpt:"用户原帖，仅作线索。",likes:5,comments:7,publishedAt:null,
    firstSeenAt:"2026-11-14T01:00:00Z",lastSeenAt:new Date().toISOString()},{
    id:"456",url:"https://maimai.cn/n/content/gossip-detail/456?egid=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb&gid=456",
    topicUrl:"https://maimai.cn/hot/topic/1",
    title:"同话题的另一条讨论",excerpt:"第二条原帖。",likes:5,comments:1,publishedAt:null,
    firstSeenAt:"2026-11-14T02:00:00Z",lastSeenAt:new Date().toISOString()}]}));
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
    await expect(page.getByRole("heading",{level:1,name:"职场热议"})).toBeVisible();
    assert.equal(await page.locator("article").count(),1);
    await page.getByText("同话题另有 1 条讨论",{exact:true}).click();
    await expect(page.getByRole("link",{name:"同话题的另一条讨论"})).toBeVisible();
    await expect(page.locator("article").getByText(/话题最近发现（北京时间）/)).toBeVisible();
    await expect(page.locator("article").getByText("发布时间未核实",{exact:true})).toBeVisible();
    await expect(page.locator("article").getByText(/发现时间（北京时间）/)).toBeVisible();
    assert.match(await page.locator('meta[name="robots"]').getAttribute("content")??"",/noindex/);
    assert.match(await page.getByRole("link",{name:"查看原帖"}).getAttribute("rel")??"",/nofollow/);
    await expect(page.locator("article p").filter({hasText:"用户原帖，仅作线索。"})).toBeHidden();
    await page.getByText("展开原帖摘录",{exact:true}).click();
    await expect(page.locator("article p").filter({hasText:"用户原帖，仅作线索。"})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const history=page.getByRole("link",{name:"近 30 天",exact:true});
    await history.click();
    await expect(history).toHaveAttribute("aria-current","page");
    await expect(page.getByRole("heading",{name:"存档的招聘冻结讨论"})).toBeVisible();
    await expect(page.getByText("发布时间未核实",{exact:true})).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content",/noindex/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole("link",{name:"下一页"}).click();
    await expect(page).toHaveURL(/view=history&page=2$/);
    await expect(page.getByRole("heading",{name:"第二页的团队缩编讨论"})).toBeVisible();
    await expect(page.getByText(/原发时间（北京时间）/)).toBeVisible();
    await expect(page.locator('time[datetime="2026-11-05T01:00:00Z"]')).toHaveText("2026-11-05 09:00");
    await page.getByRole("link",{name:"近期",exact:true}).click();
    await expect(page.getByRole("heading",{name:"腾讯绩效与年终奖讨论"})).toBeVisible();
    await page.getByRole("button",{name:"Switch to English",exact:true}).click();
    await expect(page.getByRole("heading",{level:1,name:"Workplace discussions"})).toBeVisible();
    await expect(page.getByRole("link",{name:"Past 30 days",exact:true})).toBeVisible();
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

test("a readable source can report a full day without newly collected posts",async()=>{
  quiet=true;
  const context=await browser.newContext(),page=await context.newPage();
  try {
    await page.goto(web.origin+"/workplace-leads");
    await expect(page.getByRole("status")).toContainText("公开入口可读取，近 24 小时暂无新帖收录。");
    await expect(page.getByRole("status")).toContainText("最近新增（北京时间）");
    await expect(page.getByRole("heading",{name:"腾讯绩效与年终奖讨论"})).toBeVisible();
  } finally {quiet=false;await context.close();}
});
