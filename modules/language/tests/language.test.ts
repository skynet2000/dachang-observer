import { pointModels, stub } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { publicTextValues, collectPublicText } from "@aihot/backend/publication/texts";
import language, { hashText, translateNextBatch, validTranslations } from "../server.ts";

const app = Fastify(); language.http!(app);
after(async () => { await app.close(); await closeDb(); });

test("English uses current public text only, leaves Chinese untouched, and lookup cannot invoke or enqueue models", async () => {
  assert.equal(language.schedules?.find(job => job.name === "language.translate")?.cron, "2-59/5 * * * *");
  const source = "language-fixture";
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode) VALUES(${source},'测试媒体','rss','T1','editorial')`;
  const { articleId } = await upsertMaterial({ sourceId: source, url: "https://example.com/language", title: "公司公开信", bodyText: "公司公开信正文", via: "fetch", publishedAt: new Date() });
  await sql`INSERT INTO analyses(article_id,input_revision,origin,relevance,category,title_zh,summary_zh,reason_zh,score,selected)
    VALUES(${articleId},1,'rule','pass','industry','公司公开信','公司宣布组织调整。','影响员工岗位。',80,true)`;
  await publishArticle(articleId);
  assert.ok((await publicTextValues()).includes("公司公开信"));
  assert.deepEqual(await publicTextValues(["测试媒体"]), ["测试媒体"]);
  for (const [source, english] of [["公司公开信", "A company-wide letter"], ["测试媒体", "Fixture Media"], ["机密未公开", "Private"], ["不存在的旧标题", "Old title"]]) {
    await sql`INSERT INTO language_texts(source_hash,source,english,receipt_id) VALUES(${hashText(source)},${source},${english},0)`;
  }
  const before = await sql`SELECT count(*)::int AS n FROM receipts`;
  const result = await app.inject({ method: "POST", url: "/api/language/lookup", payload: { texts: ["公司公开信", "测试媒体", "机密未公开", "不存在的旧标题"] } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json().translations, { "公司公开信": "A company-wide letter", "测试媒体": "Fixture Media" });
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM receipts`, before);
  assert.equal((await sql`SELECT title FROM publications WHERE article_id=${articleId}`)[0]!.title, "公司公开信");
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${articleId}`;
  assert.ok(!(await publicTextValues()).includes("公司公开信"));
  assert.deepEqual(await publicTextValues(["测试媒体"]), [], "a source with no public reports is not exposed");
  assert.equal((await app.inject({ method: "POST", url: "/api/language/lookup", payload: { texts: Array(65).fill("中文") } })).statusCode, 400);
});

test("report extraction skips withdrawn citations, IDs and URLs; translation checks protect numbers/placeholders", () => {
  assert.deepEqual([...collectPublicText({ title: "本期导读", sections: [{ label: "职场与组织", items: [
    { available: false, title: "撤下的稿件", summary: "不再展示" }, { available: true, title: "组织调整", itemId: "秘密ID", sourceUrl: "https://example.com/中文" },
  ] }] })], ["本期导读", "职场与组织", "组织调整"]);
  assert.ok(validTranslations(["{{0}} 条，V4.1，10:15，500元"], ["{{0}} items, V4.1, 10:15, 500 CNY"]));
  assert.equal(validTranslations(["500元"], ["50 CNY"]), false);
  assert.equal(validTranslations(["500元"], ["1500 CNY"]), false);
  assert.equal(validTranslations(["一", "二"], ["one"]), false);
  assert.equal(validTranslations(["中文"], ["<script>alert(1)</script>"]), false);
});

test("worker persists translations and completes real receipts; repeating a completed batch cannot pay for it again", async () => {
  const api = await stub((_hit, req) => {
    const input = JSON.parse(req.body);
    const texts = JSON.parse(input.messages.at(-1).content) as Array<{ id: number; text: string }>;
    return { choices: [{ message: { content: JSON.stringify({ translations: texts.map(item => ({ id: item.id, text: `English ${item.text}` })).reverse() }) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
  });
  pointModels(api.url, ["deepseek-flash"]);
  try {
    const first = await translateNextBatch();
    assert.ok(first.translated > 0);
    assert.equal(api.hits(), 1);
    const [receipt] = await sql`SELECT status FROM receipts WHERE purpose='language.english' ORDER BY id DESC LIMIT 1`;
    assert.equal(receipt!.status, "completed");
    const saved = await sql`SELECT source_hash, source, english FROM language_texts WHERE receipt_id>0`;
    assert.ok(saved.every(row => row.english === `English ${row.source}`), "reordered response ids cannot attach a translation to the wrong source");
    assert.equal(saved.length, first.translated);
    await translateNextBatch();
    assert.equal(api.hits(), 2, "the second run advances to different source texts");
    const savedAgain = new Set((await sql`SELECT source_hash FROM language_texts WHERE receipt_id>0`).map(r => r.source_hash));
    assert.ok(saved.every(r => savedAgain.has(r.source_hash)));
  } finally { await api.close(); }
});

test("a bad segment remains private and waits before retrying while other segments are saved", async () => {
  const api = await stub((_hit, req) => {
    const texts = JSON.parse(JSON.parse(req.body).messages.at(-1).content) as Array<{ id: number; text: string }>;
    return { choices: [{ message: { content: JSON.stringify({ translations: texts.map((item, i) => ({ id: item.id, text: i === 0 ? "" : `English ${item.text}` })) }) }, finish_reason: "stop" }] };
  });
  pointModels(api.url, ["deepseek-flash"]);
  try {
    const result = await translateNextBatch();
    assert.ok(result.translated > 0); assert.equal(result.failed, 1);
    const [bad] = await sql`SELECT source, english, attempts, retry_after FROM language_texts WHERE english IS NULL`;
    assert.equal(bad!.english, null); assert.equal(bad!.attempts, 1); assert.ok(bad!.retry_after.getTime() > Date.now());
    const lookup = await app.inject({ method: "POST", url: "/api/language/lookup", payload: { texts: [bad!.source] } });
    assert.deepEqual(lookup.json().translations, {});
  } finally { await api.close(); }
});

test("real translations preserve values across Chinese magnitudes, grouping commas and English date/number words", () => {
  const cases = [
    ["收藏最多500条，已读5000条。", "Up to 500 saved and 5,000 read items."],
    ["年包最高500万元", "Annual package up to 5 million yuan"],
    ["从200万元到400万至500万元，去年200万至300万元", "From 2 million yuan to 4 million to 5 million yuan, versus 2 million to 3 million yuan last year"],
    ["10月18日08:00至10月19日08:00", "08:00 on October 18 to 08:00 on October 19"],
    ["上线7个月，日活2200万", "Seven months since launch, 22 million daily active users"],
    ["季度营收168亿美元，环比45%", "Quarterly revenue of $16.8 billion, up 45%"],
    ["最快1分钟一次", "At most once per minute"],
  ];
  for (const [source, english] of cases) assert.ok(validTranslations([source!], [english!]), `${source} -> ${english}`);
  assert.equal(validTranslations(["500万元"], ["50 million yuan"]), false);
  assert.equal(validTranslations(["500万元"], ["5 billion yuan"]), false);
  assert.equal(validTranslations(["V4.1"], ["V4.2"]), false);
  assert.equal(validTranslations(["V4.1"], ["V4.10"]), false);
  assert.equal(validTranslations(["10月18日"], ["October 19"]), false);
});

test("model aliases, shopping-day grammar and inclusive company counts preserve their actual values", () => {
  const cases = [
    ["玄戒03（XRING 03）搭载LPDDR6，预计每月新增10万片。", "XRING 03 uses LPDDR6 and is expected to add 100,000 wafers per month."],
    ["双11成AI电商试验场，月活3.68亿。", "Double 11 becomes an AI e-commerce testing ground, with 368 million monthly users."],
    ["凤凰网等8家互联网企业签署公约", "Phoenix News and 7 other internet companies sign the convention"],
    ["美团等8家企业签署公约", "Meituan and seven other companies sign the convention"],
    ["均价从6.8元涨至13.46元，涨幅接近1倍。", "The average price rose from 6.8 yuan to 13.46 yuan, nearly doubling."],
  ];
  for (const [source, english] of cases) assert.ok(validTranslations([source!], [english!]), `${source} -> ${english}`);
  const wrong = [
    ["玄戒03（XRING 03）搭载LPDDR6", "XRING 04 uses LPDDR6"],
    ["玄戒03（XRING 03）搭载LPDDR6", "XRING 03 uses LPDDR5"],
    ["玄戒03（XRING 04）", "XRING 04"],
    ["营收1000万元，利润1000万元", "Revenue was 10 million yuan"],
    ["双11成AI电商试验场", "Double 110 becomes an AI e-commerce testing ground"],
    ["凤凰网等8家互联网企业签署公约", "Phoenix News and 8 other internet companies sign the convention"],
    ["均价涨幅接近1倍", "The average price nearly tripled"],
  ];
  for (const [source, english] of wrong) assert.equal(validTranslations([source!], [english!]), false, `${source} -> ${english}`);
});

test("public lookup limits bursts before doing content reads and never starts translation", async () => {
  const isolated = Fastify(); language.http!(isolated);
  try {
    for (let i = 0; i < 60; i++) assert.equal((await isolated.inject({ method: "POST", url: "/api/language/lookup", payload: { texts: [] } })).statusCode, 200);
    const limited = await isolated.inject({ method: "POST", url: "/api/language/lookup", payload: { texts: [] } });
    assert.equal(limited.statusCode, 429); assert.equal(limited.headers["retry-after"], "60");
  } finally { await isolated.close(); }
});

test("real date ranges, compound units, discounts and gaming labels keep their meaning without weakening wrong-value checks", () => {
  const cases = [
    ["腾讯3A最后的希望", "Tencent's last hope for AAA games"],
    ["17岁，5份百万美元offer", "17 years old, holding 5 million-dollar offers"],
    ["17岁，5份百万美元邀约，2.8万亿参数的Kimi K3", "17 years old, five million-dollar-level offers, the 2.8-trillion-parameter Kimi K3"],
    ["8160亿参数、420亿激活，100万token", "816-billion-parameter, 42 billion activated, 1-million-token context"],
    ["补偿10.8-10.14消费", "Refund consumption from Oct. 8-14"],
    ["下午13:04恢复，持续4小时52分钟", "Restored at 1:04 p.m., lasting 4 hours and 52 minutes"],
    ["N1搭载5000万像素，支持4K", "N1 features a 50-megapixel camera and supports 4K"],
    ["首单5折", "50% off the first order"],
    ["15或30万字，2026年11月12日至14日", "150,000 or 300,000 characters, November 12 to 14, 2026"],
  ];
  for (const [source, english] of cases) assert.ok(validTranslations([source!], [english!]), `${source} -> ${english}`);
  for (const [source, english] of [["首单5折", "70% off"], ["5000万像素", "5 megapixels"], ["13:04恢复", "Restored at 2:04 p.m."], ["补偿10.8-10.14消费", "Refund November 8-14"], ["腾讯3A", "Tencent AA"], ["保持活跃的10多家", "Only a dozen or so remain"]]) assert.equal(validTranslations([source!], [english!]), false);
});

test("observed approximate amounts, shared range units and half minutes pass without admitting wrong numbers", () => {
  for (const [source, english] of [
    ["尾款70来万元，佣金33250元", "A remaining balance of about 700,000 yuan and a 33,250 yuan commission"],
    ["985高校，年薪600万，年包200至300万元", "A 985 university, 6 million yuan salary, and a 2 to 3 million yuan annual package"],
    ["1分半钟，成本300元，330万播放", "1.5 minutes, 300 yuan in costs, and 3.3 million views"],
    ["基础优惠低至7.2折", "Base discounts as low as 72% of the original price"],
  ]) assert.ok(validTranslations([source!], [english!]), `${source} -> ${english}`);
  for (const [source, english] of [
    ["70来万元", "About 70,000 yuan"], ["200至300万元", "2 to 30 million yuan"],
    ["1分半钟", "15 minutes"], ["7.2折", "Discounts of 70% of the original price"],
    ["8点1氪，487万元", "8 AM briefing, 4.87 million yuan"],
  ]) assert.equal(validTranslations([source!], [english!]), false);
});


test("observed share and billionaire translations preserve counts without confusing Chinese words or English people with units", () => {
  for (const [source, english] of [
    ["中国人4成上网时间给了字节跳动，份额41.8%", "Chinese people spend 40% of their online time on ByteDance, a 41.8% share"],
    ["3.5成用户", "35% of users"],
    ["针对约250名亿万富翁征收5%财富税", "A 5% wealth tax targeting about 250 billionaires"],
    ["股票以14成交", "Shares traded at 14"],
  ]) assert.ok(validTranslations([source!], [english!]), `${source} -> ${english}`);
  for (const [source, english] of [
    ["4成用户", "4% of users"], ["4成用户", "50% of users"],
    ["250人", "2,500 people"], ["2500亿美元", "250 billionaires"],
  ]) assert.equal(validTranslations([source!], [english!]), false, `${source} -> ${english}`);
});
