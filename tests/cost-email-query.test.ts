import "./setup.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { tag } from "./setup.ts";

after(closeDb);

test("the email totals yesterday's live charges and flags incomplete paid costs", async () => {
  const query = execFileSync("python3", ["-c", "import runpy; print(runpy.run_path('deploy/cost-report.py')['QUERY'])"], { encoding: "utf8" });
  const rows = [
    { service: "intern", status: "received", usage: { total_tokens: 20 }, cost: null },
    { service: "scnet", status: "received", usage: { total_tokens: 100 }, cost: null },
    { service: "scnet", status: "received", usage: {}, cost: null },
    { service: "scnet", status: "failed", usage: null, cost: null },
    { service: "scnet", status: "unknown", usage: null, cost: null },
    { service: "siliconflow", status: "received", usage: { total_tokens: 60 }, cost: 0.1 },
    { service: "aihubmix", status: "received", usage: { total_tokens: 80 }, cost: 0.01 },
    { service: "deepseek", status: "received", usage: { total_tokens: 50 }, cost: 0.25 },
    { service: "deepseek", status: "unknown", usage: null, cost: null },
    { service: "deepseek", status: "received", usage: {}, cost: null },
    { service: "deepseek", status: "received", usage: {}, cost: 8, today: true },
  ];
  for (const r of rows) {
    const [receipt] = await sql`INSERT INTO receipts(logical_key,service,purpose,status,request)
      VALUES(${tag()},${r.service},'translate_body',${r.status},'{}') RETURNING id`;
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,origin,status,usage,cost,currency,started_at)
      VALUES(${receipt!.id},1,${r.service},'test-model','live',${r.status},${r.usage ? sql.json(r.usage) : null},${r.cost},${r.cost === null ? null : r.service === "aihubmix" ? "USD" : "CNY"},
      (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')+make_interval(hours => ${r.today ? 0 : -1})) AT TIME ZONE 'Asia/Shanghai')`;
  }
  const [row] = await sql.unsafe(query);
  const report = row!.json_build_object;
  assert.equal(Number(report.paid_cny), 0.35);
  assert.equal(Number(report.paid_usd), 0.01);
  assert.equal(report.unknown_outcomes, 1);
  assert.equal(report.unpriced_paid, 1);
});
