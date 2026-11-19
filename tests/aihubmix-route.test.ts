import { stub, Reply, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test, mock } from 'node:test';
import { z } from 'zod';
import { chatJson } from '@aihot/backend/providers/llm';
import { closeDb, sql } from '@aihot/backend/db';
import { reserveModelCost } from '@aihot/backend/providers/model-cost';
after(closeDb);
const answer={model:'deepseek-v4-1-flash-261017',choices:[{message:{content:'{"ok":true}'}}],usage:{prompt_tokens:40,completion_tokens:20}};
const ask=(model='intern-flash')=>chatJson({model,purpose:'aihubmix-test',subject:tag(),promptVersion:tag(),system:'JSON',user:tag(),schema:z.object({ok:z.boolean()})});
async function providers(middle:Parameters<typeof stub>[0],run:(p:Awaited<ReturnType<typeof stub>>,s:Awaited<ReturnType<typeof stub>>,m:Awaited<ReturnType<typeof stub>>,f:Awaited<ReturnType<typeof stub>>)=>Promise<void>){
 const p=await stub(()=>new Reply(429,{error:'quota exceeded'})),s=await stub(()=>answer),m=await stub(middle),f=await stub(()=>answer);
 const env={INTERN_BASE_URL:p.url,INTERN_API_KEY:'test',SILICONFLOW_BASE_URL:s.url,SILICONFLOW_API_KEY:'test',AIHUBMIX_BASE_URL:m.url,AIHUBMIX_API_KEY:'test',DEEPSEEK_BASE_URL:f.url,DEEPSEEK_API_KEY:'test'};
 const before=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
 try{await run(p,s,m,f);}finally{for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await Promise.all([p.close(),s.close(),m.close(),f.close()]);}
}
test('AIHubMix follows Intern directly even with legacy SiliconFlow credentials',async()=>{
 const modes:string[]=[];
 await providers((_hit,req)=>{const body=JSON.parse(req.body);assert.equal(body.model,'deepseek-v4.1-flash-1017');modes.push(body.thinking.type);assert.equal(body.reasoning_effort,body.thinking.type==='disabled'?'none':'low');return answer;},async(p,s,m,f)=>{
  assert.equal((await ask()).model,'aihubmix-flash');assert.equal((await ask('intern-flash-think')).model,'aihubmix-flash-think');
  assert.deepEqual(modes,['disabled','enabled']);assert.deepEqual([p.hits(),s.hits(),m.hits(),f.hits()],[1,0,2,0]);
 });
});
test('an exhausted AIHubMix tier reaches the official final tier once and keeps independent receipts',async()=>{
 await providers(()=>new Reply(402,{error:'Insufficient Balance'}),async(p,s,m,f)=>{
  const r=await ask('intern-flash-think');assert.equal(r.model,'deepseek-flash-think');assert.deepEqual([p.hits(),s.hits(),m.hits(),f.hits()],[1,0,1,1]);
  const rows=await sql`SELECT service,status FROM receipts WHERE subject=(SELECT subject FROM receipts WHERE id=${r.receiptId}) ORDER BY id`;
  assert.deepEqual(rows.map(r=>[r.service,r.status]),[['intern','failed'],['aihubmix','failed'],['deepseek','received']]);
 });
});
test('AIHubMix usage is recorded in USD and a finite CNY cap cannot silently admit it',async()=>{
 const old=process.env.LLM_DAILY_BUDGET_CNY;process.env.LLM_DAILY_BUDGET_CNY='unlimited';
 try{await providers(()=>answer,async(_p,_s,m,_f)=>{
  process.env.AIHUBMIX_BASE_URL='https://aihubmix.com/v1';
  const original=globalThis.fetch;
  const intercepted=mock.method(globalThis,'fetch',(url: Parameters<typeof fetch>[0],options?:Parameters<typeof fetch>[1])=>{
   assert.equal(String(url),'https://aihubmix.com/v1/chat/completions');return original(m.url+'/chat/completions',options);
  });
  try{
   const r=await ask('aihubmix-flash');const[row]=await sql`SELECT cost,currency,cost_basis FROM receipts WHERE id=${r.receiptId}`;
   assert.equal(row!.currency,'USD');assert.equal(row!.cost_basis,'estimated');assert.equal(Number(row!.cost),0.000038);
  }finally{intercepted.mock.restore();}
 });
 process.env.LLM_DAILY_BUDGET_CNY='0.5';
 assert.throws(()=>reserveModelCost('https://aihubmix.com/v1',{model:'deepseek-v4.1-flash-1017'}),/finite CNY budget/);
 }finally{if(old===undefined)delete process.env.LLM_DAILY_BUDGET_CNY;else process.env.LLM_DAILY_BUDGET_CNY=old;}
});
