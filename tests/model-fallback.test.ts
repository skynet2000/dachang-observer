import { stub, Reply, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { z } from "zod";
import { chatJson, MODELS } from "@aihot/backend/providers/llm";
import { closeDb, sql } from "@aihot/backend/db";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";
import { reserveModelCost } from "@aihot/backend/providers/model-cost";
import { config } from "@aihot/backend/config";

after(closeDb);
const answer = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 2, completion_tokens: 4 } };
const call = (model = "intern-flash") => chatJson({ model, purpose: "fallback-test", subject: tag(), promptVersion: tag(), system: "Return JSON", user: "test", schema: z.object({ ok: z.boolean() }) });
async function withProviders(primary: Parameters<typeof stub>[0], run: (p: Awaited<ReturnType<typeof stub>>, f: Awaited<ReturnType<typeof stub>>) => Promise<void>) {
  const p = await stub(primary), m = await stub(() => new Reply(402, { error: "Insufficient Balance" })), f = await stub(() => answer);
  Object.assign(process.env, { INTERN_BASE_URL: p.url, INTERN_API_KEY: "test", AIHUBMIX_BASE_URL: m.url, AIHUBMIX_API_KEY: "test", DEEPSEEK_BASE_URL: f.url, DEEPSEEK_API_KEY: "test" });
  try { await run(p, f); } finally { await p.close(); await m.close(); await f.close(); }
}

test("successful priority answers use the exact requested version and never pay the fallback", async () => {
  await withProviders((_hit, req) => { assert.equal(JSON.parse(req.body).model, "deepseek-v4.1-flash-1017"); return answer; }, async (p, f) => {
    const result = await call(); assert.equal(result.model, "intern-flash"); assert.equal(p.hits(), 1); assert.equal(f.hits(), 0);
    const [r] = await sql`SELECT service, model FROM receipts WHERE id=${result.receiptId}`;
    assert.equal(r!.service, "intern"); assert.equal(r!.model, "deepseek-v4.1-flash-1017");
  });
});

test("an explicitly rate-rejected primary gets one recovery chance before a paid fallback", async () => {
  await withProviders(hit => hit === 1 ? new Reply(429, { error: "Channel rate limit reached for model" }) : answer, async (p,f) => {
    const result = await call();
    assert.equal(result.model,"intern-flash");
    assert.equal(p.hits(),2); assert.equal(f.hits(),0);
    const attempts = await sql`SELECT status FROM receipt_attempts WHERE receipt_id=${result.receiptId} ORDER BY attempt`;
    assert.deepEqual(attempts.map(a=>a.status),['failed','received']);
  });
});

test("known quota exhaustion is shared until a recovery probe restores primary priority", async () => {
  let recover = false;
  await withProviders(() => recover ? answer : new Reply(429, { error: "quota exceeded" }), async (p, f) => {
    assert.equal((await call()).model, "deepseek-flash");
    assert.equal((await call("intern-flash-think")).model, "deepseek-flash-think");
    assert.equal(p.hits(), 1); assert.equal(f.hits(), 2);
    recover = true;
    await sql`UPDATE settings SET value=jsonb_set(value,'{until}','0') WHERE key LIKE 'model.health.intern.%'`;
    assert.equal((await call()).model, "intern-flash"); assert.equal(p.hits(), 2); assert.equal(f.hits(), 2);
  });
});

test("unusable primary output falls back while keeping both receipts", async () => {
  await withProviders(() => ({ choices: [{ message: { content: "invalid json" } }] }), async (p, f) => {
    assert.equal((await call()).model, "deepseek-flash"); assert.equal(p.hits(), 2); assert.equal(f.hits(), 1);
  });
});

test("local budget stops and disabled model calls never bypass controls through fallback", async () => {
  await withProviders(() => answer, async (p, f) => {
    await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('intern',0,0,0) ON CONFLICT(service) DO UPDATE SET per_minute=0`;
    try { await assert.rejects(call(), BudgetExceededError); }
    finally { await sql`DELETE FROM budgets WHERE service='intern'`; }
    config.modelCallsEnabled = false;
    try { await assert.rejects(call(), /disabled/); }
    finally { config.modelCallsEnabled = true; }
    assert.equal(p.hits(), 0); assert.equal(f.hits(), 0);
  });
});

test("unknown quota pricing is allowed only without a monetary cap and never fabricated as zero", () => {
  const before = process.env.LLM_DAILY_BUDGET_CNY;
  const body = { model: "deepseek-v4.1-flash-1017", max_tokens: 512, messages: [{ content: "test" }] };
  try {
    process.env.LLM_DAILY_BUDGET_CNY = "unlimited";
    assert.equal(reserveModelCost("https://discovery-api.intern-ai.org.cn/v1", body), undefined);
    assert.throws(() => reserveModelCost("https://example.com/v1", body));
    process.env.LLM_DAILY_BUDGET_CNY = "0.5";
    assert.throws(() => reserveModelCost("https://discovery-api.intern-ai.org.cn/v1", body));
  } finally { if (before === undefined) delete process.env.LLM_DAILY_BUDGET_CNY; else process.env.LLM_DAILY_BUDGET_CNY = before; }
});

test("a timed-out primary retains an unknown receipt and follows the fallback chain once", async () => {
  await withProviders(async () => { await new Promise(resolve => setTimeout(resolve, 800)); return answer; }, async (p, f) => {
    const result = await chatJson({ model: "intern-flash", purpose: "timeout-fallback-test", subject: tag(), promptVersion: tag(), system: "JSON", user: "test", schema: z.object({ ok: z.boolean() }), timeoutMs: 500 });
    assert.equal(result.model, "deepseek-flash"); assert.equal(p.hits(), 1); assert.equal(f.hits(), 1);
    const rows = await sql`SELECT service,status FROM receipts WHERE purpose='timeout-fallback-test' ORDER BY id`;
    assert.deepEqual(rows.map(r => [r.service, r.status]), [["intern", "unknown"], ["aihubmix", "failed"], ["deepseek", "received"]]);
  });
});

test("production uses Intern, AIHubMix, and DeepSeek in order for both modes", () => {
  assert.equal(MODELS["intern-flash"]!.fallback, "aihubmix-flash");
  assert.equal(MODELS["intern-flash-think"]!.fallback, "aihubmix-flash-think");
  assert.equal(MODELS["aihubmix-flash"]!.fallback, "deepseek-flash");
  assert.equal(MODELS["aihubmix-flash-think"]!.fallback, "deepseek-flash-think");
  assert.ok(!Object.values(MODELS).some(model => model.service === "siliconflow" || model.service === "scnet"));
});
