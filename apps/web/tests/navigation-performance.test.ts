import { EDITORIAL } from "@aihot/site";
// Failure modes, fixed before changing public loaders or prefetch:
// - returning to a page that was already open still needs the network;
// - query variants mix content/SEO, or restores lose their anchor;
// - intent no longer loads data, scroll-through touches download it, or a failed prefetch breaks the current page;
// - visits renew deadlines, expired/errors stay cached, or refresh stops working;
// - Agent tabs choose an invalid panel or leave canonical/history behind;
// - search downloads two whole pages, requests before opening, or never retries/updates suggestions.
// Reader work failures fixed before changing enhancement and return-position code:
// - offscreen code downloads/runs immediately, visible code stays plain, or raw copying changes;
// - tiny/linked pictures become zoom buttons, or language changes keep old handlers;
// - a deep return loses its anchor, or folded dates confuse the anchor search.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { chromium, webkit, expect, type Browser } from "@playwright/test";
import type { FeedItemSummary, SiteItemDetail, ReportDetail, HotStripEntry, PoolResponse } from "@aihot/contracts/site";
import { startWebServer, type WebServer } from "./web-server.ts";

const at = '2026-10-04T08:00:00.000Z';
const item: FeedItemSummary = {id:'navigation-fixture',title:'性能检查文章',summary:'固定摘要',reason:'固定推荐理由',source:{name:'Fixture'},publishedAt:at,timelineAt:at,category:'ai-models',tags:[],score:80,selected:true,channel:'news',x:null};
const topHot: HotStripEntry[] = Array.from({length:5},(_,i)=>({rank:i+1,title:`大厂热点 ${i+1}：组织调整与业务与竞争的最新进展`,heat:100-i,trend:'up',storyPublicId:'fixture',itemId:null,participants:[],participantCount:0}));
const detail: SiteItemDetail = {...item,x:null,originalTitle:'Fixture article',links:{original:'https://example.org/article'},discoveredAt:at,story:null,readingMode:'full',author:null,body:{zh:'<p>固定正文</p>',original:null,zhKind:'translation',complete:true},outline:[],relatedStories:[],topics:[],indexable:true,markdownAvailable:true,group:null,hasTranslation:true,bodyLanguage:'zh'};
const codeSource='import json\n\nwith open("data.json") as file:\n    data = json.load(file)\n\nfor record in data:\n    print(record["title"])\n';
const readerBody=Array.from({length:30},(_,i)=>`<p>阅读段落 ${i}：先阅读文章，再查看后面的代码和图片。正文保持可读，图片和代码在需要时增强。</p>`).join('')
  +`<pre><code>${codeSource}</code></pre><pre><code>x = 1</code></pre>`
  +Array.from({length:12},(_,i)=>`<img src="/reader-image/${i}.svg" alt="正文配图 ${i}" width="640" height="360" loading="lazy">`).join('')
  +'<img src="/reader-image/tiny.svg" alt="小图标" width="16" height="16" loading="lazy"><a href="https://example.org"><img src="/reader-image/linked.svg" alt="链接图片" width="640" height="360" loading="lazy"></a>';
const report = (kind:'daily'|'weekly'|'monthly'): ReportDetail => ({kind,key:kind==='daily'?'2026-10-04':kind==='weekly'?'2026-W40':'2026-10',issueNumber:1,title:'Fixture '+kind,generatedAt:at,lead:{title:'Fixture '+kind,leadParagraph:'Fixture report'},leadItemId:null,overview:null,highlights:[],sections:[],flashes:[],cover:null,metrics:{},readingMinutes:1,prev:null,next:null});
const hits: string[] = [];
let suggestionsVersion=1;
let failing='';
let ttl=60;
let emptyTimeline=false;
let web:WebServer;
let origin:string;
let chrome:Browser;
let safari:Browser;
const api=createServer((req,res)=>{
  const url=new URL(req.url!,'http://local');
  const p=url.pathname;
  res.setHeader('Content-Type','application/json');
  if(p==='/api/site/meta') return res.end(JSON.stringify({changelogVersion:'fixture'}));
  if(p==='/api/reader/session') return res.end(JSON.stringify({enabled:true,providers:['google','github'],user:null}));
  if(p==='/api/site/track'){res.statusCode=204;return res.end();}
  hits.push(req.url!);
  if(p===failing){res.statusCode=503;return res.end(JSON.stringify({code:'unavailable'}));}
  if(p==='/api/health')return res.end('{}');
  if(p==='/api/site/search/suggestions')return res.end(JSON.stringify({topics:[{slug:'openai',name:'OpenAI',group:'company'}],hot:[{rank:1,title:'建议版本 '+suggestionsVersion,to:'/story/fixture'}]}));
  if(p==='/api/site/topics')return res.end(JSON.stringify({groups:[],topics:[{slug:'openai',name:'OpenAI',group:'company',definition:'Fixture',brand:null,total:0,recent:0,indexable:false,latest:null}]}));
  if(p==='/api/site/hot')return res.end(JSON.stringify({computedAt:at,windowHours:48,entries:[{rank:1,story:{publicId:'fixture',title:'建议版本 '+suggestionsVersion},heat:10,trend:'flat',trendPct:0,badges:[],participantCount:0,sourceCount:0,sourceNames:[],participants:[],spark:[],summary:null,latest:null,cover:null}]}));
  if(p==='/api/site/timeline'){
    res.setHeader('X-Accel-Expires','@'+(Math.floor(Date.now()/1000)+ttl));
    const category=url.searchParams.get('category');
    if(emptyTimeline) return res.end(JSON.stringify({filters:{channel:'all',category,tag:null},cards:[],nextCursor:null,hot:null,dayCounts:{}}));
    const shown={...item,title:category?'分类 '+category:'性能检查文章'};
    if(url.searchParams.get('tag')==='hot-layout')return res.end(JSON.stringify({filters:{channel:'all',category,tag:'hot-layout'},cards:[{key:item.id,anchorAt:at,item,group:null}],nextCursor:null,hot:topHot,dayCounts:{'2026-10-04':1}}));
    if(url.searchParams.get('tag')==='new-development'){
      return res.end(JSON.stringify({filters:{channel:'all',category:null,tag:'new-development'},cards:[{key:item.id,anchorAt:'2026-10-06T11:07:00Z',item,group:{factId:'fixture-fact',reportCount:2,additionalSourceCount:1,scope:'story',developmentCount:2}}],nextCursor:null,hot:null,dayCounts:{'2026-10-06':1}}));
    }
    if(url.searchParams.get('tag')==='long-reading'){
      const cards=Array.from({length:180},(_,i)=>({key:'long-'+i,anchorAt:i<60?at:'2026-10-03T08:00:00.000Z',item:{...item,id:'long-'+i,title:'长列表文章 '+i,summary:'用于核实深处阅读返回的固定摘要。'.repeat(3)},group:null}));
      return res.end(JSON.stringify({filters:{channel:'all',category:null,tag:'long-reading'},cards,nextCursor:null,hot:null,dayCounts:{'2026-10-04':60,'2026-10-03':120}}));
    }
    return res.end(JSON.stringify({filters:{channel:url.searchParams.get('channel')??'all',category,tag:url.searchParams.get('tag')},cards:[{key:shown.id,anchorAt:at,item:shown,group:null}],nextCursor:null,hot:null,dayCounts:{'2026-10-04':1}}));
  }
  if(p==='/api/site/pool'){
    res.setHeader('X-Accel-Expires','@'+(Math.floor(Date.now()/1000)+ttl));
    const page=Number(url.searchParams.get('page')||1),tag=url.searchParams.get('tag'),category=url.searchParams.get('category');
    const empty=emptyTimeline||url.searchParams.get('q')==='empty-query';
    let items: PoolResponse["items"]=empty?[]:[{...item,title:category?'分类 '+category:page===1?'性能检查文章':'全部第 '+page+' 页',...(tag==='group-test'?{group:{factId:'group-fixture',scope:'story',developmentCount:3,reportCount:3,additionalSourceCount:0}}:{})}];
    if(tag==='new-development')items=[{...item,anchorAt:'2026-10-06T11:07:00Z',group:{factId:'fixture-fact',reportCount:2,additionalSourceCount:1,scope:'story',developmentCount:2}}] as typeof items;
    if(tag==='long-reading')items=Array.from({length:180},(_,i)=>({...item,id:'long-'+i,title:'长列表文章 '+i,anchorAt:i<60?at:'2026-10-03T08:00:00.000Z'}));
    return res.end(JSON.stringify({filters:{channel:'all',category,tag,q:url.searchParams.get('q'),tab:url.searchParams.get('tab')==='relevance'?'relevance':'time'},items,page,pageCount:empty?0:3,total:empty?0:items.length,todayCount:1,freshness:at,hot:tag==='hot-layout'?topHot:null}));
  }
  if(p==='/api/site/items/navigation-fixture')return res.end(JSON.stringify(detail));
  if(p==='/api/site/items/navigation-fixture/original')return res.end(JSON.stringify({...detail,body:{zh:null,original:'<p>Original fixture</p>',zhKind:null,complete:true},bodyLanguage:'original'}));
  if(p==='/api/site/items/reader-fixture')return res.end(JSON.stringify({...detail,id:'reader-fixture',title:'阅读增强检查',body:{...detail.body,zh:readerBody}}));
  if(p==='/api/site/items/reader-fixture/original')return res.end(JSON.stringify({...detail,id:'reader-fixture',title:'阅读增强检查',body:{...detail.body,zh:null,original:'<p>Original reader text</p>'},bodyLanguage:'original'}));
  if(p.startsWith('/api/site/items/long-'))return res.end(JSON.stringify({...detail,id:p.split('/').at(-1),title:'长列表详情'}));
  const kind=p.match(/^\/api\/site\/reports\/(daily|weekly|monthly)\/latest-page$/)?.[1] as 'daily'|'weekly'|'monthly'|undefined;
  if(kind){const r=report(kind);return res.end(JSON.stringify({report:r,index:[{key:r.key,issueNumber:1,title:r.title,count:0}]}));}
  res.statusCode=404;res.end(JSON.stringify({code:'not_found'}));
});

before(async()=>{
  // Started together; whatever started is stopped in after() even when another one failed.
  const started=await Promise.allSettled([
    startWebServer(api).then(w=>{web=w;origin=w.origin;}),
    chromium.launch({channel:'chromium'}).then(b=>{chrome=b;}),
    webkit.launch().then(b=>{safari=b;}),
  ]);
  for(const result of started)if(result.status==='rejected')throw result.reason;
});
after(async()=>{
  await chrome?.close();await safari?.close();
  await web?.stop();
});

// One engine per behaviour: WebKit for what phone readers do (iPhone Safari), Chromium for desktop-only
// intent such as hover. The router and caches are the same code in both.
test('default home shows All with four navigation destinations and no selection marks',async()=>{
  for(const width of [390,1280]){
    const context=await chrome.newContext({viewport:{width,height:900}}),page=await context.newPage();
    try{const before=hits.length;await page.goto(origin+'/');await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
      const nav=page.getByRole('navigation',{name:width<961?'底部导航':'主导航',exact:true});
      await expect(page).toHaveTitle('大厂观察 · 资讯');
      assert.deepEqual(await nav.getByRole('link').allTextContents(),['资讯','热点','日报','我的']);
      await expect(nav.getByRole('link',{name:'资讯',exact:true})).toHaveAttribute('aria-current','page');
      assert.equal(hits.slice(before).some(p=>p.startsWith('/api/site/timeline')),false);
      await expect(page.getByText('AI 评分',{exact:true})).toHaveCount(0);
      await expect(page.getByText('精选',{exact:true})).toHaveCount(0);
      await expect(page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'综合',exact:true})).toHaveAttribute('aria-current','page');
      await page.getByRole('button',{name:'Switch to English',exact:true}).click();
      await expect(page.getByRole('navigation',{name:width<961?'Bottom navigation':'Main navigation',exact:true}).getByRole('link',{name:'News',exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.getByRole('navigation',{name:'Category',exact:true}).getByRole('link',{name:'All topics',exact:true})).toHaveAttribute('aria-current','page');
    }finally{await context.close();}
  }
});

test('browser tab follows the open section and language without adding another title', async () => {
  for (const [browser, width] of [[safari, 390], [chrome, 1280]] as const) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      const response = await page.goto(origin + '/all?category=jobs');
      assert.match(await response!.text(), /<title>大厂观察 · 资讯<\/title>/);
      const nav = page.getByRole('navigation', { name: width < 961 ? '底部导航' : '主导航', exact: true });
      for (const name of ['热点', '日报', '我的']) {
        await nav.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveTitle(`大厂观察 · ${name}`);
        await expect(page.locator('head title')).toHaveCount(1);
      }
      await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
      await expect(page).toHaveTitle('大厂观察 · Me');
      await page.getByRole('navigation', { name: width < 961 ? 'Bottom navigation' : 'Main navigation', exact: true })
        .getByRole('link', { name: 'News', exact: true }).click();
      await expect(page).toHaveTitle('大厂观察 · News');
      await page.reload();
      await expect(page).toHaveTitle('大厂观察 · 资讯');

      for (const [path, title] of [['/weekly', '大厂观察 · 周报'], ['/monthly', '大厂观察 · 月报'], ['/items/navigation-fixture', '性能检查文章 · 大厂观察']]) {
        await page.goto(origin + path);
        await expect(page).toHaveTitle(title!);
        await expect(page.locator('head title')).toHaveCount(1);
      }
    } finally { await context.close(); }
  }
});

test('SSR list and visited query variants return offline without another read',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  try{
    await page.goto(origin+'/');
    await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'性能检查文章',exact:true}).click();
    await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    await context.setOffline(true);
    await page.goBack();
    await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible({timeout:1500});
    await context.setOffline(false);
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'经营与竞争',exact:true}).click();
    await expect(page.getByRole('link',{name:'分类 industry',exact:true})).toBeVisible();
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'裁员与招聘',exact:true}).click();
    await expect(page.getByRole('link',{name:'分类 jobs',exact:true})).toBeVisible();
    await context.setOffline(true);
    await page.goBack();
    await expect(page.getByRole('link',{name:'分类 industry',exact:true})).toBeVisible({timeout:1500});
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',origin+'/all?category=industry');
  }finally{await context.close();}
});

test('hover still fetches article data, touches that move do not, and failed prefetch does not replace the current page',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await page.goto(origin+'/');
    const link=page.getByRole('link',{name:'性能检查文章',exact:true});
    await page.mouse.move(0,0);
    const start=hits.length;
    await link.dispatchEvent('touchstart');await link.dispatchEvent('touchmove');
    await page.waitForTimeout(150); // Let the intent timer expire without a real mouse crossing the card.
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/items/')).length,0);
    const response=page.waitForResponse(r=>r.url().includes('/items/navigation-fixture.data'));
    await link.hover();await response;
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/items/')).length,1);
    await link.click();await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/items/')).length,1,'navigation reuses its intent-prefetched response');
    const fresh=await chrome.newContext();const freshPage=await fresh.newPage();
    try{
      await freshPage.goto(origin+'/');failing='/api/site/items/navigation-fixture';
      const failed=freshPage.waitForResponse(r=>r.url().includes('/items/navigation-fixture.data')&&r.status()===503);
      await freshPage.getByRole('link',{name:'性能检查文章',exact:true}).hover();await failed;
      await expect(freshPage.getByRole('heading',{name:'行业变化，持续发生。',exact:true})).toBeVisible();
    }finally{await fresh.close();}
  }finally{failing='';await context.close();}
});

test('SSR all-pages and report kinds return offline with their own content',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await page.goto(origin+'/all');
    await page.locator('a[href="/all?page=2"]').first().click();
    await expect(page.getByRole('link',{name:'全部第 2 页',exact:true})).toBeVisible();
    await context.setOffline(true);await page.goBack();
    await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible({timeout:1500});
    await context.setOffline(false);await page.goto(origin+'/daily');
    await page.getByRole('link',{name:'周报',exact:true}).click();
    await expect(page.locator('#report-start')).toContainText('周报');
    await context.setOffline(true);await page.locator('a[href="/daily"]').filter({visible:true}).first().click();
    await expect(page.locator('#report-start')).toContainText('日报',{timeout:1500});
  }finally{await context.close();}
});

// A prefetch of the newly selected link must not be mistaken for an explicit refresh of that page.
// Disable HTTP reuse here: otherwise the browser cache can hide a lost document-level result.
test('intent on a selected link preserves visited data and the next revisit starts no data request',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  const requests:string[]=[];
  await context.route('**/*.data*',route=>route.continue());
  page.on('request',request=>{if(request.url().includes('.data'))requests.push(request.url());});
  try{
    await page.goto(origin+'/');
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'经营与竞争',exact:true}).click();
    await expect(page.getByRole('link',{name:'分类 industry',exact:true})).toBeVisible();
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'经营与竞争',exact:true}).focus();
    await page.waitForTimeout(150);
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'裁员与招聘',exact:true}).click();
    await expect(page.getByRole('link',{name:'分类 jobs',exact:true})).toBeVisible();
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'裁员与招聘',exact:true}).focus();
    await page.waitForTimeout(150);
    const before=requests.length;
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'经营与竞争',exact:true}).click();
    await expect(page.getByRole('link',{name:'分类 industry',exact:true})).toBeVisible();
    assert.deepEqual(requests.slice(before),[],'neither prefetch nor navigation may evict and reload a still-valid visited page');
  }finally{await context.close();}
});

test('a revisit never renews the original deadline; an expired read shows an error and a reload asks again',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await page.clock.install();ttl=1;
    await page.goto(origin+'/');
    await page.getByRole('link',{name:'性能检查文章',exact:true}).click();await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    failing='/api/site/pool';
    await page.clock.runFor(1500);
    await page.goBack();await expect(page.getByRole('heading',{name:'暂时无法加载',exact:true})).toBeVisible();
    failing='';ttl=60;
    await page.reload();await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
  }finally{ttl=60;failing='';await context.close();}
});

test('SSR freshness spent in an upstream cache is not renewed by HTML hydration',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    ttl=0;await page.goto(origin+'/');
    await page.getByRole('link',{name:'性能检查文章',exact:true}).click();await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    const start=hits.length;ttl=60;
    await page.goBack();await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/pool')).length,1);
  }finally{ttl=60;await context.close();}
});

test('Agent tabs finish offline with matching canonical; invalid direct tabs and anchored links keep a panel',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await page.goto(origin+'/agent');
    await context.setOffline(true);
    await page.getByRole('tablist',{name:'接入方式'}).getByRole('tab',{selected:true}).click();
    await expect(page.locator('#agent-panel')).not.toBeEmpty();
    for(const [tab,name] of [['mcp',/^MCP/],['rss',/^RSS/],['api',/^REST API/]] as const){
      const choice=page.getByRole('tab',{name});
      // The active track was exercised above; compare navigation through every remaining track.
      if(await choice.getAttribute('aria-selected')==='true')continue;
      const target=await choice.getAttribute('href');
      await choice.click();
      await expect(page).toHaveURL(origin+target,{timeout:1500});
      await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',origin+target);
      await expect(page.locator('#agent-panel')).toHaveAttribute('aria-labelledby','agent-tab-'+tab);
      await expect(page.locator('#agent-panel')).not.toBeEmpty();
    }
    await context.setOffline(false);
    await page.goto(origin+'/agent?tab=unknown');
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected','true');
    await expect(page.locator('#agent-panel')).not.toBeEmpty();
    await page.goto(origin+'/agent#agent-api-recovery');
    await expect(page.locator('#agent-api-recovery')).toBeVisible();
  }finally{await context.close();}
});

test('phone suggestions load only on opening, use one small read, retry failures and update on reopening',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  try{
    suggestionsVersion=1;await page.goto(origin+'/');
    assert.equal(hits.filter(x=>x==='/api/site/search/suggestions').length,0);
    let start=hits.length;
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 1',exact:true})).toBeVisible();
    assert.deepEqual(hits.slice(start),['/api/site/search/suggestions']);
    await page.getByRole('button',{name:'取消',exact:true}).click();
    suggestionsVersion=2;start=hits.length;
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 2',exact:true})).toBeVisible();
    assert.deepEqual(hits.slice(start),['/api/site/search/suggestions']);
    await page.getByRole('button',{name:'取消',exact:true}).click();
    failing='/api/site/search/suggestions';await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 2',exact:true})).not.toBeVisible();
    await page.getByRole('button',{name:'取消',exact:true}).click();failing='';suggestionsVersion=3;
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 3',exact:true})).toBeVisible();
  }finally{failing='';await context.close();}
});

test('reader enhancements wait for visible code and update only the picture that loaded',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const scripts:string[]=[];page.on('request',r=>{if(r.url().includes('/assets/')&&r.url().includes('highlight-'))scripts.push(r.url());});
  await page.route('**/reader-image/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().endsWith('/tiny.svg')?16:640}" height="360"><rect width="640" height="360" fill="red"/></svg>`}));
  try{
    await page.goto(origin+'/items/reader-fixture');
    await expect(page.getByRole('heading',{name:'阅读增强检查',exact:true})).toBeVisible();
    await expect(page.locator('.code-block-copy')).toHaveCount(2);
    assert.deepEqual(scripts,[],'reading the introduction must not download the offscreen highlighter');
    const source=page.locator('.prose pre code').first();
    assert.equal(await source.textContent(),codeSource);
    await source.scrollIntoViewIfNeeded();
    await expect(source).toHaveClass(/hljs/);
    assert.equal(await source.textContent(),codeSource,'colouring preserves the copyable text');
    assert.equal(scripts.length,1);
    await page.locator('.code-block-copy').first().click();
    await expect(page.locator('.code-block-copy').first()).toHaveText('已复制');
    assert.equal(await page.locator('.prose pre code').nth(1).textContent(),'x = 1');
    for(let i=0;i<12;i++){
      const picture=page.locator(`.prose img[alt="正文配图 ${i}"]`);
      await picture.scrollIntoViewIfNeeded();
      await expect(picture).toHaveAttribute('role','button');
    }
    const tiny=page.locator('.prose img[alt="小图标"]');await tiny.scrollIntoViewIfNeeded();
    await expect(tiny).not.toHaveAttribute('role','button');
    await expect(page.locator('.prose a img')).not.toHaveAttribute('role','button');
    await page.getByRole('navigation',{name:'正文语言'}).getByRole('link',{name:'原文',exact:true}).click();
    await expect(page.getByText('Original reader text',{exact:true})).toBeVisible();
    assert.equal(await page.locator('.code-block-copy').count(),0);
  }finally{await context.close();}
});

test('retained selected timeline restores deep anchors and folded dates',{skip:!EDITORIAL.selectionEnabled},async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  try{
    await page.goto(origin+'/?tag=long-reading');
    await expect(page.locator('[data-card-key]')).toHaveCount(180);
    await page.getByRole('button',{name:'收起10月4日',exact:true}).click();
    await expect(page.locator('[data-card-key]')).toHaveCount(120);
    await page.getByRole('link',{name:'长列表文章 160',exact:true}).scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>{
      const first=[...document.querySelectorAll<HTMLElement>('[data-card-key]')].find(e=>e.getBoundingClientRect().bottom>72)!;
      return {key:first.dataset.cardKey!,top:first.getBoundingClientRect().top};
    });
    await page.getByRole('link',{name:'长列表文章 160',exact:true}).click();
    await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-card-key]')).toHaveCount(120);
    await expect.poll(()=>page.locator(`[data-card-key="${before.key}"]`).evaluate((e,top)=>Math.abs(e.getBoundingClientRect().top-top),before.top)).toBeLessThan(2);
    await expect(page.getByRole('button',{name:'展开10月4日',exact:true})).toBeVisible();
  }finally{await context.close();}
});


test('event reports recover from invalid responses, timeouts and stale refreshes on phone and desktop',async()=>{
  for(const width of [390,1280]){
    const context=await chrome.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    let response:'invalid'|'ok'|'error'|'empty'|'timeout'='invalid';
    let requests=0;
    try{
      await page.route('**/api/site/groups/**/reports*',async route=>{
        requests++;
        if(response==='timeout'){await route.abort('timedout');return;}
        await route.fulfill({status:response==='error'?503:200,contentType:'application/json',body:JSON.stringify(
          response==='invalid'?{reports:[null]}: {factId:'group-fixture',reports:response==='empty'?[]:[
            {id:'other-report',title:'服务恢复进展',source:{name:'测试媒体'},timelineAt:at,originalUrl:'https://example.org/report'}
          ]})});
      });
      await page.goto(origin+'/all?tag=group-test');
      const toggle=page.getByRole('button',{name:'3 条进展 · 3 篇报道',exact:true}).filter({visible:true});
      await toggle.click();
      const retry=page.getByRole('button',{name:'暂时无法加载，点此重试',exact:true});
      await expect(retry).toBeVisible();
      response='timeout';await retry.click();await expect(retry).toBeVisible();
      response='ok';await retry.click();
      await expect(page.getByText('服务恢复进展',{exact:true})).toBeVisible();
      await expect(page.getByText('10月4日 16:00',{exact:true})).toBeVisible();
      if(width===390){
        await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
        response='error';await toggle.click();
        const staleRetry=page.getByRole('button',{name:'更新失败，当前为上次内容，点此重试',exact:true});
        await expect(staleRetry).toBeVisible();
        await expect(page.getByText('服务恢复进展',{exact:true})).toBeVisible();
        response='empty';await staleRetry.click();
        await expect(page.getByText('暂无其他可显示的报道',{exact:true})).toBeVisible();
        await expect(page.getByText('服务恢复进展',{exact:true})).toHaveCount(0);
      }
      assert.ok(requests>=3);
    }finally{await context.close();}
  }
});

test('open event reports follow category changes and history without showing a false empty state',async t=>{
  for(const width of [390,1280])await t.test(`${width}px`,async()=>{
    const context=await chrome.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    const requests:string[]=[];
    let holdBack=false,releaseBack=()=>{};
    const backGate=new Promise<void>(resolve=>{releaseBack=resolve;});
    try{
      await page.route('**/api/site/groups/**/reports*',async route=>{
        const category=new URL(route.request().url()).searchParams.get('category');
        requests.push(category??'all');
        if(holdBack&&!category)await backGate;
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({factId:'group-fixture',reports:[
          {id:'other-report',title:category?'招聘栏的其他报道':'综合栏的其他报道',source:{name:'测试媒体'},timelineAt:at,originalUrl:'https://example.org/report'}
        ]})});
      });
      await page.goto(origin+'/all?tag=group-test');
      const category=page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'裁员与招聘',exact:true});
      if(width===390){await category.click();await expect(category).toHaveAttribute('aria-current','page');}
      const toggle=page.getByRole('button',{name:'3 条进展 · 3 篇报道',exact:true}).filter({visible:true});
      await toggle.click();
      await expect(page.getByText(width===390?'招聘栏的其他报道':'综合栏的其他报道',{exact:true})).toBeVisible();
      if(width===390)await page.goBack();
      else await category.click();
      await expect(page.getByText(width===390?'综合栏的其他报道':'招聘栏的其他报道',{exact:true})).toBeVisible();
      assert.deepEqual(requests,width===390?['jobs','all']:['all','jobs']);
      await expect(page.getByText('暂无其他可显示的报道',{exact:true})).toHaveCount(0);
      if(width===1280){
        holdBack=true;
        const refreshed=page.waitForResponse(r=>r.url().includes('/api/site/groups/')&&!new URL(r.url()).searchParams.has('category'));
        await page.goBack();
        await expect.poll(()=>requests.length).toBe(3);
        await expect(page.getByText('综合栏的其他报道',{exact:true})).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded','true');
        releaseBack();await refreshed;
      }
    }finally{releaseBack();await context.close();}
  });
});


test('reader navigation has four categories on desktop and phone; old model links select business',async()=>{
  const labels=['综合','裁员与招聘','职场与组织','经营与竞争','政策与监管'];
  for(const width of [390,1280]){
    const context=await chrome.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    try{
      await page.goto(origin+'/');
      const nav=page.getByRole('navigation',{name:'栏目',exact:true});
      assert.deepEqual(await nav.getByRole('link').allTextContents(),labels);
      for(const label of labels){
        const link=nav.getByRole('link',{name:label,exact:true});
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport({ratio:0.99});
      }
      await expect(page.getByRole('button',{name:/^筛选/})).toHaveCount(0);
      await page.goto(origin+'/?category=ai-models');
      await expect(page.getByRole('link',{name:'分类 industry',exact:true})).toBeVisible();
      await expect(page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'经营与竞争',exact:true})).toHaveAttribute('aria-current','page');
    }finally{await context.close();}
  }
});

test('old category links open their merged group without losing tags or search',async()=>{
  for(const width of [390,1280]){const context=await chrome.newContext({viewport:{width,height:900}}),page=await context.newPage();
    try{await page.goto(origin+'/all?category=career&tag=组织调整&q=岗位');
      await expect(page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'职场与组织',exact:true})).toHaveAttribute('aria-current','page');
      await expect(page.getByRole('link',{name:'取消标签：组织调整',exact:true})).toBeVisible();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }finally{await context.close();}}
});

test('phone navigation marks All independently, all categories are visible and repeated taps preserve search filters',async()=>{
  for(const width of [320,390,768]){
    const context=await safari.newContext({viewport:{width,height:844}}),page=await context.newPage();
    try{
      await page.goto(origin+'/all?category=career&q=岗位');
      const bottom=page.getByRole('navigation',{name:'底部导航',exact:true});
      assert.deepEqual(await bottom.getByRole('link').allTextContents(),['资讯','热点','日报','我的']);
      const all=bottom.getByRole('link',{name:'资讯',exact:true});
      await expect(all).toHaveAttribute('aria-current','page');
      await expect(bottom.getByRole('link',{name:'精选',exact:true})).toHaveCount(0);
      await all.click();
      await expect(page).toHaveURL(url=>url.pathname==='/all'&&url.searchParams.get('q')==='岗位'&&['career','workplace'].includes(url.searchParams.get('category')??''));
      const rail=page.getByRole('navigation',{name:'栏目',exact:true});
      await expect(rail).toBeVisible();
      await rail.getByRole('link',{name:'政策与监管',exact:true}).click();
      await expect(page).toHaveURL(url=>url.searchParams.get('category')==='policy'&&url.searchParams.get('q')==='岗位');
      const selected=rail.getByRole('link',{name:'政策与监管',exact:true});
      await expect(selected).toHaveAttribute('aria-current','page');
      await expect(selected).toBeInViewport({ratio:0.99}); // WebKit rounds fractional scroll offsets.
      const bounds=await rail.boundingBox(),choice=await selected.boundingBox();
      assert.ok(bounds&&choice&&choice.x>=bounds.x-1&&choice.x+choice.width<=bounds.x+bounds.width+1,'active category stays inside the category grid');
      for(const link of await bottom.getByRole('link').all()){
        const box=await link.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44,'phone tabs are touch targets');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:`outputs/手机导航-搜索-${width}-20261021.png`,fullPage:true});
    }finally{await context.close();}
  }
});

test('phone categories, tags and query can each be cleared independently without a filter dialog',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  try{
    await page.goto(origin+'/all?category=career&tag=组织调整&q=岗位');
    const categories=page.getByRole('navigation',{name:'栏目',exact:true});
    await categories.getByRole('link',{name:'裁员与招聘',exact:true}).click();
    await expect(page).toHaveURL(url=>url.searchParams.get('q')==='岗位'&&url.searchParams.get('category')==='jobs'&&url.searchParams.get('tag')==='组织调整');
    await page.getByRole('link',{name:'取消搜索：岗位',exact:true}).click();
    await expect(page).toHaveURL(url=>!url.searchParams.has('q')&&!url.searchParams.has('tab')&&url.searchParams.get('category')==='jobs'&&url.searchParams.get('tag')==='组织调整');
    await page.getByRole('link',{name:'取消标签：组织调整',exact:true}).click();
    await expect(page).toHaveURL(url=>url.searchParams.get('category')==='jobs'&&!url.searchParams.has('tag'));
    await categories.getByRole('link',{name:'综合',exact:true}).click();
    await expect(page).toHaveURL(origin+'/all');
    await expect(page.getByRole('button',{name:/^筛选/})).toHaveCount(0);
  }finally{await context.close();}
});

test('category changes reset pagination but keep search and tag; desktop can clear a tag',async()=>{
  const context=await chrome.newContext({viewport:{width:1024,height:900}}),page=await context.newPage();
  try{
    await page.goto(origin+'/all?channel=firstParty&tag=组织调整&q=岗位&page=2&deep=1&anchorAt=old');
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'职场与组织',exact:true}).click();
    await expect(page).toHaveURL(url=>['career','workplace'].includes(url.searchParams.get('category')??'')&&!url.searchParams.has('channel')&&url.searchParams.get('q')==='岗位'&&!['page','deep','anchorAt'].some(key=>url.searchParams.has(key)));
    await page.getByRole('link',{name:'取消标签：组织调整',exact:true}).click();
    await expect(page).toHaveURL(url=>!url.searchParams.has('tag')&&['career','workplace'].includes(url.searchParams.get('category')??'')&&!url.searchParams.has('channel'));
    await expect(page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'职场与组织',exact:true})).toHaveAttribute('aria-current','page');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await context.close();}
});

test('phone search preserves feed filters and can change category without losing its query',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  try{
    await page.goto(origin+'/?category=industry&channel=firstParty&tag=组织调整');
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    const search=page.getByRole('dialog',{name:'搜索',exact:true});
    await search.getByRole('searchbox').fill('岗位');
    await search.getByRole('searchbox').press('Enter');
    await expect(page).toHaveURL(url=>url.pathname==='/all'&&url.searchParams.get('q')==='岗位'&&url.searchParams.get('category')==='industry'&&!url.searchParams.has('channel')&&url.searchParams.get('tag')==='组织调整');
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'职场与组织',exact:true}).click();
    await expect(page).toHaveURL(url=>['career','workplace'].includes(url.searchParams.get('category')??'')&&url.searchParams.get('q')==='岗位'&&!url.searchParams.has('channel'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await context.close();}
});

test('desktop category filters are reachable and preserve search',async()=>{
  const context=await chrome.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  try{
    await page.goto(origin+'/all?category=career&q=招聘');
    await expect(page.getByRole('button',{name:/^筛选/})).toHaveCount(0);
    await page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'政策与监管',exact:true}).click();
    await expect(page).toHaveURL(url=>url.searchParams.get('category')==='policy'&&url.searchParams.get('q')==='招聘'&&!url.searchParams.has('channel'));
    await expect(page.getByRole('link',{name:'取消筛选：一手',exact:true})).toHaveCount(0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
  }finally{await context.close();}
});


test('empty searches can clear filters without losing their query and explain full-text ordering',async()=>{
  for(const width of [390,1280]){
    const context=await chrome.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    try{
      await page.goto(origin+'/all?category=career&channel=firstParty&q=empty-query&tag=组织调整');
      await expect(page.getByRole('link',{name:'清除筛选',exact:true})).toBeVisible();
      await page.getByRole('link',{name:'试试“全文相关”，连正文一起搜',exact:true}).click();
      await expect(page.getByText('按全文相关程度排列 · 同一事件合并展示，可展开查看进展')).toBeVisible();
      await expect(page).toHaveURL(url=>['career','workplace'].includes(url.searchParams.get('category')??'')&&!url.searchParams.has('channel')&&url.searchParams.get('tab')==='relevance');
      await page.getByRole('link',{name:'清除筛选',exact:true}).click();
      await expect(page).toHaveURL(url=>url.searchParams.get('q')==='empty-query'&&!url.searchParams.has('category')&&!url.searchParams.has('channel')&&!url.searchParams.has('tag'));
    }finally{await context.close();}
  }
});

test('a query typed before hydration survives hydration and submits with its filters',async()=>{
  const context=await chrome.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  let release!:()=>void;
  const hydration=new Promise<void>(resolve=>{release=resolve;});
  try{
    await page.route(/\/assets\/entry\.client-[^/]+\.js$/,async route=>{await hydration;await route.continue();});
    await page.goto(origin+'/all?q=招聘&tab=relevance&category=career&tag=组织调整',{waitUntil:'commit'});
    const input=page.getByRole('textbox',{name:'搜索标题、摘要与正文',exact:true});
    await input.fill('岗位');
    release();
    await expect(page.locator('[role="dialog"][aria-label="搜索"]')).toHaveCount(1);
    await expect(input).toHaveValue('岗位');
    await input.press('Enter');
    await expect(page).toHaveURL(url=>url.searchParams.get('q')==='岗位'&&url.searchParams.get('tab')==='relevance'&&['career','workplace'].includes(url.searchParams.get('category')??'')&&url.searchParams.get('tag')==='组织调整');
  }finally{release();await context.close();}
});

test('editing a full-text query preserves its search mode and filters on both layouts',async()=>{
  for(const width of [390,1280]){
    const context=await chrome.newContext({viewport:{width,height:900}}),page=await context.newPage();
    try{
      await page.goto(origin+'/all?q=招聘&tab=relevance&category=career&tag=组织调整');
      if(width<961){
        await page.getByRole('button',{name:'招聘',exact:true}).click();
        const search=page.getByRole('dialog',{name:'搜索',exact:true});
        await expect(search.getByRole('searchbox')).toHaveAccessibleName('搜索标题、摘要与正文');
        await search.getByRole('searchbox').fill('岗位');
        await search.getByRole('searchbox').press('Enter');
      }else{
        await page.getByRole('textbox',{name:'搜索标题、摘要与正文',exact:true}).fill('岗位');
        await page.getByRole('textbox',{name:'搜索标题、摘要与正文',exact:true}).press('Enter');
      }
      await expect(page).toHaveURL(url=>url.searchParams.get('q')==='岗位'&&url.searchParams.get('tab')==='relevance'&&['career','workplace'].includes(url.searchParams.get('category')??'')&&url.searchParams.get('tag')==='组织调整');
      await expect(page.getByText('按全文相关程度排列 · 同一事件合并展示，可展开查看进展')).toBeVisible();
    }finally{await context.close();}
  }
});

test('hot overview uses source-scoped counts and translates dates without a model',async()=>{
  for(const width of [320,390,1280]){
    const context=await chrome.newContext({viewport:{width,height:844}}),page=await context.newPage();
    try{
    await page.goto(origin+'/hot');
    await expect(page.getByRole('list',{name:'热点榜',exact:true})).toBeVisible();
    const first=await page.getByRole('list',{name:'热点榜',exact:true}).getByRole('listitem').first().boundingBox();
    assert.ok(first&&first.height>=44&&first.height<=56,'phone rankings are compact touchable rows');
    await expect(page.getByRole('list',{name:'热点榜',exact:true}).getByRole('link').first()).toHaveAttribute('href','/story/fixture');
    await expect(page.getByText('过去 48 小时 · 已收录信源中的 1 个热点').filter({visible:true})).toBeVisible();
    await page.getByRole('button',{name:'Switch to English'}).click();
    await expect(page.getByText('Past 48 hours · 1 trend across our sources').filter({visible:true})).toBeVisible();
    await expect(page.getByText('Updated Oct 4 16:00',{exact:true}).filter({visible:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }finally{await context.close();}
  }
});


test('a new event development does not replace the representative report publication date',async()=>{
  const context=await chrome.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  try{
    await page.goto(origin+'/?tag=new-development');
    await expect(page.getByText('按事件最新进展排列 · 同一事件合并展示，可展开查看进展')).toBeVisible();
    const card=page.locator('[data-item-id="navigation-fixture"]');
    await expect(card.locator('time')).toHaveAttribute('datetime',at);
    await expect(card.locator('time')).toHaveText('· 10/04');
    await expect(page.getByRole('region',{name:'2026-10-06'})).toBeVisible();
  }finally{await context.close();}
});

test('top hotspots precede one reading column and phone feeds use one toolbar',async()=>{
  for(const width of [320,390,768,1280,1920]){
    const context=await chrome.newContext({viewport:{width,height:900}}),page=await context.newPage();
    try{
      await page.goto(origin+'/?tag=hot-layout');
      const hot=page.getByRole('region',{name:'全站热点',exact:true});
      await expect(hot).toBeVisible();
      assert.equal(await hot.getByRole('listitem').count(),width<961?3:5);
      const rows=await hot.getByRole('listitem').all();
      let previousBottom=0;
      for(const row of rows){
        const box=await row.boundingBox();assert.ok(box&&box.y>=previousBottom&&box.height<=52,'ranking flows vertically as short rows');
        previousBottom=box.y+box.height;
      }
      const heatBoxes=await hot.locator('.hot-rank-heat').filter({visible:true}).evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().right));
      assert.ok(heatBoxes.every(x=>Math.abs(x-heatBoxes[0]!)<1),'heat values share a right-aligned column');
      await expect(hot.locator('.hot-rank-badge')).toHaveCount(0); // Upward trends alone do not justify a hot/new badge.
      const hotBox=await hot.boundingBox(),cardBox=await page.locator('[data-item-id]').boundingBox();
      assert.ok(hotBox&&hotBox.height<=(width<961?180:240),'homepage board stays short and leaves room for the news');
      assert.ok(hotBox&&cardBox&&hotBox.y+hotBox.height<=cardBox.y,'hotspots appear above the feed, never beside it');
      assert.ok(hotBox&&cardBox&&Math.abs(hotBox.x-cardBox.x)<2&&Math.abs(hotBox.width-cardBox.width)<2,'hotspots and news share the same reading column');
      if(width<961){
        await expect(page.locator('[data-phone-bar]')).toHaveCount(0);
        await expect(page.locator('[data-site-header]').getByRole('button',{name:'搜索',exact:true})).toBeVisible();
        const account=page.getByRole('link',{name:'登录并同步',exact:true});
        await expect(account).toBeVisible();
        const accountBox=await account.boundingBox();assert.ok(accountBox&&accountBox.x+accountBox.width<=width,'account stays inside narrow phone headers');
        for(const link of await hot.getByRole('list').getByRole('link').all()){
          const box=await link.boundingBox(); assert.ok(box&&box.height>=44,'hot links remain touch targets');
        }
        const rail=page.getByRole('navigation',{name:'栏目',exact:true});
        for(const link of await rail.getByRole('link').all()){
          await link.scrollIntoViewIfNeeded();
          await expect(link).toBeInViewport({ratio:0.99});
        }
        const choice=rail.getByRole('link',{name:'政策与监管',exact:true});
        await choice.click();
        await expect(choice).toHaveAttribute('aria-current','page');
        await expect(choice).toBeInViewport({ratio:0.99});
        const bounds=await rail.boundingBox();assert.ok(bounds&&bounds.height<54,'categories occupy one row');
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }finally{await context.close();}
  }
});

test('four categories preserve search and tags across Chinese and English, including narrow layouts',async()=>{
  const choices=[['jobs','裁员与招聘','Jobs & hiring'],['workplace','职场与组织','Work & people'],['industry','经营与竞争','Business & competition'],['policy','政策与监管','Policy & regulation']];
  for(const width of [320,390,1024,1280]){
    const context=await chrome.newContext({viewport:{width,height:900}}),page=await context.newPage();
    try{
      await page.goto(origin+'/all?q=岗位&tag=组织调整');
      for(const language of ['zh','en']){
        if(language==='en')await page.getByRole('button',{name:'Switch to English'}).click();
        const rail=page.getByRole('navigation',{name:language==='zh'?'栏目':'Category',exact:true});
        for(const [key,zh,en] of choices){
          const choice=rail.getByRole('link',{name:language==='zh'?zh:en,exact:true});
          await choice.click();
          await expect(page).toHaveURL(url=>url.searchParams.get('category')===key&&url.searchParams.get('q')==='岗位'&&url.searchParams.get('tag')==='组织调整');
          await expect(choice).toHaveAttribute('aria-current','page');
          await expect(choice).toBeInViewport({ratio:0.99});
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:`outputs/四栏导航-${width}-${language}-20261024.png`,fullPage:true});
      }
      await page.reload();
      await expect(page.getByRole('navigation',{name:'栏目',exact:true}).getByRole('link',{name:'政策与监管',exact:true})).toBeInViewport({ratio:0.99});
    }finally{await context.close();}
  }
});
