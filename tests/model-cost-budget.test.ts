import { gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { z } from "zod";
import { closeDb, sql } from "@aihot/backend/db";
import { budgetedOutputTokens, modelCost, reserveModelCost } from "@aihot/backend/providers/model-cost";
import { BudgetExceededError, paidRequest, ProviderRejectedError, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import { adaptIntervals, syncCollectionIntervals } from "@aihot/backend/sources/collect";
import { collectionIntervalMinutes } from "@aihot/site";
import { chatJson } from "@aihot/backend/providers/llm";

const request = (maxAmount = 0.3, service = "cost-test") => ({
  service, model: "fixture", purpose: "cost-test", identity: tag(),
  costBudget: { maxAmount, dailyLimit: 0.5, currency: "CNY" },
});
const outcome = (amount: number) => ({ response: {}, cost: { amount, currency: "CNY", basis: "estimated" as const } });
beforeEach(async () => { await sql`TRUNCATE receipts CASCADE`; });
after(closeDb);

test("parallel services reserve their full bills before sending; settlement releases only unused allowance", async () => {
  const started = gate(); const finish = gate(); let sent = 0;
  const first = paidRequest(request(), async () => { sent++; started.open(); await finish.promise; return outcome(0.2); });
  await started.promise;
  try { await assert.rejects(paidRequest(request(0.3, "other-service"), async () => { sent++; return outcome(0.3); }), BudgetExceededError); }
  finally { finish.open(); await first; }
  await paidRequest(request(0.3, "other-service"), async () => { sent++; return outcome(0.3); });
  assert.equal(sent, 2);
  const [sum] = await sql`SELECT sum(cost)::text AS cost FROM receipt_attempts`;
  assert.equal(Number(sum!.cost), 0.5);
});

test("received answers reuse their receipt even when the money is exhausted", async () => {
  const req = request(0.5); let sent = 0;
  const first = await paidRequest(req, async () => { sent++; return outcome(0.5); });
  const again = await paidRequest(req, async () => { sent++; return outcome(0.5); });
  assert.equal(again.receiptId, first.receiptId); assert.equal(again.reused, true); assert.equal(sent, 1);
});

test("unknown outcomes and missing usage retain their full reservation", async () => {
  await assert.rejects(paidRequest(request(), async () => { throw Error("connection reset after send"); }), ReceiptUnknownError);
  await assert.rejects(paidRequest(request(), async () => outcome(0.1)), BudgetExceededError);
  await paidRequest(request(0.2), async () => ({ response: {} }));
  const [sum] = await sql`SELECT sum(cost)::text AS cost FROM receipt_attempts`;
  assert.equal(Number(sum!.cost), 0.5);
});

test("a provider refusal releases its reservation, while a successful retry is charged", async () => {
  const req = request(0.5);
  await assert.rejects(paidRequest(req, async () => { throw new ProviderRejectedError("HTTP 429", 429, true); }), ProviderRejectedError);
  await paidRequest(req, async () => outcome(0.2));
  const rows = await sql`SELECT cost::text AS cost FROM receipt_attempts ORDER BY id`;
  assert.deepEqual(rows.map(r => Number(r.cost)), [0, 0.2]);
});

test("unpriced historical requests stop calls; an expired reservation leaves the rolling window", async () => {
  await paidRequest({ ...request(), costBudget: undefined }, async () => ({ response: {} }));
  await assert.rejects(paidRequest(request(), async () => outcome(0.1)), BudgetExceededError);
  await sql`UPDATE receipt_attempts SET started_at = now() - interval '25 hours'`;
  await paidRequest(request(), async () => outcome(0.1));
});

test("peak pricing keeps cache discounts and rounds up to the ledger's precision", () => {
  assert.equal(modelCost({ prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 500 }), 0.00182);
  assert.equal(modelCost({ prompt_tokens: 1, completion_tokens: 0 }), 0.000002);
  assert.equal(modelCost(null), null);
  assert.equal(modelCost({ prompt_tokens: 2, completion_tokens: 1, prompt_cache_hit_tokens: 3 }), null);
});

test("unlimited development preserves reasoning output room and still records its full cost bound", (t) => {
  const names = ["LLM_DAILY_BUDGET_CNY", "LLM_BUDGET_UNLIMITED_DATE"];
  const previous = names.map(name => process.env[name]);
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-18T10:00:00Z") });
  try {
    process.env.LLM_DAILY_BUDGET_CNY = "unlimited";
    delete process.env.LLM_BUDGET_UNLIMITED_DATE;
    assert.equal(budgetedOutputTokens(13024), 13024);
    const body = { model: "deepseek-flash", max_tokens: 13024, reasoning_effort: "low", messages: [{ role: "user", content: "test" }] };
    const cost = reserveModelCost("https://api.deepseek.com/v1", body)!;
    assert.equal(cost.dailyLimit, null);
    assert.ok(cost.maxAmount > 13024 * 8 / 1e6);
    assert.throws(() => reserveModelCost("https://api.deepseek.com/v1", { ...body, reasoning_effort: "unknown" }), /Unsupported reasoning/);
    process.env.LLM_DAILY_BUDGET_CNY = "0.5";
    assert.equal(budgetedOutputTokens(13024), 4096);
    process.env.LLM_BUDGET_UNLIMITED_DATE = "2026-10-18";
    assert.equal(budgetedOutputTokens(13024), 13024);
    t.mock.timers.setTime(new Date("2026-10-18T16:00:00Z").getTime());
    assert.equal(budgetedOutputTokens(13024), 4096);
  } finally {
    t.mock.timers.reset();
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});

test("the unlimited date expires at Beijing midnight without losing the configured cap", (t) => {
  const names = ["LLM_DAILY_BUDGET_CNY", "LLM_BUDGET_UNLIMITED_DATE"];
  const previous = names.map(name => process.env[name]);
  Object.assign(process.env, { LLM_DAILY_BUDGET_CNY: "0.5", LLM_BUDGET_UNLIMITED_DATE: "2026-10-13" });
  const body = { model: "deepseek-flash", max_tokens: 1000, messages: [{ role: "user", content: "中文" }] };
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-12T15:59:59Z") });
  const budget = () => reserveModelCost("https://api.deepseek.com/v1", body)!;
  try {
    assert.equal(budget().dailyLimit, 0.5);
    t.mock.timers.setTime(new Date("2026-10-12T16:00:00Z").getTime());
    assert.equal(budget().dailyLimit, null);
    assert.equal(budget().maxAmount, 0.01006);
    t.mock.timers.setTime(new Date("2026-10-13T16:00:00Z").getTime());
    assert.equal(budget().dailyLimit, 0.5);
  } finally {
    t.mock.timers.reset();
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});

test("unlimited requests keep their costs and the restored cap counts that spending", async () => {
  const unlimited = () => ({ ...request(), costBudget: { maxAmount: 0.3, dailyLimit: null, currency: "CNY" } });
  await paidRequest(unlimited(), async () => outcome(0.3));
  await paidRequest(unlimited(), async () => outcome(0.3));
  const [sum] = await sql`SELECT sum(cost)::text AS cost FROM receipt_attempts`;
  assert.equal(Number(sum!.cost), 0.6);
  await assert.rejects(paidRequest(request(0.01), async () => outcome(0.01)), BudgetExceededError);
});

test("request reservation bounds Chinese text and refuses unpriced models, endpoints and image inputs", () => {
  const previous = process.env.LLM_DAILY_BUDGET_CNY;
  process.env.LLM_DAILY_BUDGET_CNY = "0.5";
  const body = { model: "deepseek-flash", max_tokens: 1000, messages: [{ role: "user", content: "中文" }] };
  try {
    const bound = reserveModelCost("https://api.deepseek.com/v1", body)!;
    assert.equal(bound.maxAmount, 0.01006);
    assert.throws(() => reserveModelCost("https://example.com", body));
    assert.throws(() => reserveModelCost("https://api.deepseek.com", { ...body, model: "deepseek-v4-pro" }));
    assert.throws(() => reserveModelCost("https://api.deepseek.com", { ...body, messages: [{ content: [{ type: "image_url" }] }] }));
  } finally { if (previous === undefined) delete process.env.LLM_DAILY_BUDGET_CNY; else process.env.LLM_DAILY_BUDGET_CNY = previous; }
});

test("collection remains every two hours across Beijing midnight and interval adaptation", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-22T01:00:00Z") });
  assert.equal(collectionIntervalMinutes(), 120);
  t.mock.timers.setTime(new Date("2026-10-23T01:00:00Z").getTime());
  assert.equal(collectionIntervalMinutes(), 120);
  const id = `two-hour-${tag()}`;
  await sql`INSERT INTO sources (id,name,kind,config,tier,enabled,interval_minutes) VALUES (${id},'two-hour fixture','rss','{}','T2',true,15)`;
  await adaptIntervals();
  const [row] = await sql`SELECT interval_minutes FROM sources WHERE id=${id}`;
  assert.equal(row!.interval_minutes, 120);
});

test("the minute scheduler moves an existing deadline and preserves longer failure backoff and disabled sources", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-22T01:00:00Z") });
  const ids = [tag(), tag(), tag(), tag()];
  for (const [index, id] of ids.entries()) {
    await sql`INSERT INTO sources (id,name,kind,config,tier,enabled,interval_minutes,last_fetch_at,next_fetch_at,fail_count)
      VALUES (${id},'interval fixture','rss','{}','T2',${index !== 2},60,
        ${index === 3 ? sql`NULL` : sql`now()`}, now() + make_interval(mins => ${index === 1 ? 360 : 60}), ${index === 1 ? 1 : 0})`;
  }
  await syncCollectionIntervals();
  const rows = await sql`SELECT id,interval_minutes,extract(epoch from (next_fetch_at - coalesce(last_fetch_at,now()))) / 60 AS wait
    FROM sources WHERE id IN ${sql(ids)}`;
  const get = (i: number) => rows.find(r => r.id === ids[i])!;
  assert.equal(get(0).interval_minutes, 120); assert.ok(Math.abs(Number(get(0).wait) - 120) < 1);
  assert.equal(get(1).interval_minutes, 120); assert.ok(Number(get(1).wait) >= 359);
  assert.equal(get(2).interval_minutes, 60);
  assert.ok(Math.abs(Number(get(3).wait)) < 1);
  assert.equal(await syncCollectionIntervals(), 0);
});

test("the Maimai override reschedules healthy runs and caps existing backoff", async () => {
  const id = "external-maimai-posts";
  await sql`INSERT INTO sources (id,name,kind,config,tier,enabled,interval_minutes,last_fetch_at,next_fetch_at)
    VALUES (${id},'Maimai posts','external','{}','T2',true,120,now(),now() + interval '2 hours')`;
  const read = async () => (await sql`SELECT interval_minutes,
    extract(epoch from (next_fetch_at - last_fetch_at)) / 60 AS wait FROM sources WHERE id=${id}`)[0]!;
  await syncCollectionIntervals();
  assert.equal((await read()).interval_minutes, 30);
  assert.equal(Number((await read()).wait), 30);
  await sql`UPDATE sources SET interval_minutes=120, fail_count=3, next_fetch_at=last_fetch_at + interval '6 hours' WHERE id=${id}`;
  await adaptIntervals();
  assert.equal((await read()).interval_minutes, 30);
  assert.equal(Number((await read()).wait), 120);
});

test("the enabled cost limit caps oversized output allowances on the wire and in the receipt", async () => {
  const names = ["LLM_DAILY_BUDGET_CNY", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
  const previous = names.map(name => process.env[name]); const originalFetch = globalThis.fetch;
  Object.assign(process.env, { LLM_DAILY_BUDGET_CNY: "0.5", LLM_BASE_URL: "https://api.deepseek.com/v1", LLM_API_KEY: "test-key", LLM_MODEL: "deepseek-flash" });
  let sent = 0;
  // An in-memory provider: this test never connects to DeepSeek or sends credentials outside the process.
  globalThis.fetch = async (_url, options) => {
    sent++; const body = JSON.parse(String(options?.body)); assert.equal(body.max_tokens, 4096);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  };
  try {
    await chatJson({ model: "default", purpose: "cost-test", promptVersion: "test", subject: tag(), system: "s", user: "u", maxTokens: 16384, schema: z.object({ ok: z.boolean() }) });
    const [row] = await sql`SELECT request,cost FROM receipts WHERE service='llm'`;
    assert.equal(row!.request.maxTokens, 4096); assert.equal(Number(row!.cost), 0.00001); assert.equal(sent, 1);
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});


test("development unlimited mode keeps cost accounting across midnight and rejects invalid settings", (t) => {
  const previous = process.env.LLM_DAILY_BUDGET_CNY;
  const body = { model: "deepseek-flash", max_tokens: 1000, messages: [{ content: "test" }] };
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T15:59:59Z") });
  try {
    process.env.LLM_DAILY_BUDGET_CNY = "unlimited";
    const before = reserveModelCost("https://api.deepseek.com/v1", body)!;
    assert.equal(before.dailyLimit, null);
    assert.ok(before.maxAmount > 0);
    t.mock.timers.tick(2000);
    assert.equal(reserveModelCost("https://api.deepseek.com/v1", body)!.dailyLimit, null);
    process.env.LLM_DAILY_BUDGET_CNY = "0.5";
    assert.equal(reserveModelCost("https://api.deepseek.com/v1", body)!.dailyLimit, 0.5);
    for (const invalid of ["0", "-1", "NaN", "Infinity", "Unlimited"]) {
      process.env.LLM_DAILY_BUDGET_CNY = invalid;
      assert.throws(() => reserveModelCost("https://api.deepseek.com/v1", body));
    }
  } finally { if (previous === undefined) delete process.env.LLM_DAILY_BUDGET_CNY; else process.env.LLM_DAILY_BUDGET_CNY = previous; }
});
