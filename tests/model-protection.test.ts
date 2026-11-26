import "./model-chain-fixture.ts";
import {stub,Reply,tag,gate} from './setup.ts';
import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {z} from 'zod';
import {chatJson} from '@aihot/backend/providers/llm';
import {sql,closeDb} from '@aihot/backend/db';
import {failureKind,ProviderCoolingError,retryAfterMs,recordModelHealth} from '@aihot/backend/providers/model-health';
import {BudgetExceededError} from '@aihot/backend/providers/receipts';
after(closeDb);
const answer={choices:[{message:{content:'{"ok":true}'}}]};
const ask=(model='intern-flash')=>chatJson({model,purpose:'protection-test',subject:tag(),promptVersion:tag(),system:'JSON',user:tag(),schema:z.object({ok:z.boolean()})});
test("periodic background work defers on rate limits before buying a fallback", async () => {
 await providers(()=>new Reply(429,{error:'rate limit'},{'Retry-After':'60'}),()=>answer,async(p,m,f)=>{
  await assert.rejects(chatJson({model:'intern-flash',purpose:'language.english',subject:tag(),promptVersion:tag(),
   system:'JSON',user:tag(),schema:z.object({ok:z.boolean()}),deferOnRateLimit:true}),ProviderCoolingError);
  assert.deepEqual([p.hits(),m.hits(),f.hits()],[1,0,0]);
  assert.equal((await ask()).model,'test-middle');
 });
});
async function providers(primary:Parameters<typeof stub>[0],middle:Parameters<typeof stub>[0],run:(p:Awaited<ReturnType<typeof stub>>,m:Awaited<ReturnType<typeof stub>>,f:Awaited<ReturnType<typeof stub>>)=>Promise<void>){
 const p=await stub(primary),m=await stub(middle),f=await stub(()=>answer);
 const names=['INTERN_BASE_URL','INTERN_API_KEY','TEST_MIDDLE_URL','TEST_MIDDLE_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_API_KEY'];const old=names.map(k=>process.env[k]);
 Object.assign(process.env,{INTERN_BASE_URL:p.url,INTERN_API_KEY:'test',TEST_MIDDLE_URL:m.url,TEST_MIDDLE_KEY:'test',DEEPSEEK_BASE_URL:f.url,DEEPSEEK_API_KEY:'test'});
 try{await run(p,m,f);}finally{names.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});await Promise.all([p.close(),m.close(),f.close()]);}
}
test('quota exhaustion is not retried, is shared between variants and survives another process',async()=>{
 await providers(()=>new Reply(429,{error:{message:'quota exceeded'}}),()=>answer,async(p,m,f)=>{
  assert.equal((await ask()).model,'test-middle');assert.equal(p.hits(),1);
  assert.equal((await ask('intern-flash-think')).model,'test-middle-think');assert.equal(p.hits(),1);assert.equal(f.hits(),0);
  const states=await sql`SELECT key,value FROM settings WHERE key LIKE 'model.health.%' AND value->>'reason'='quota'`;assert.equal(states.length,1);assert.equal(states[0]!.value.reason,'quota');
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  await promisify(execFile)(process.execPath,['--input-type=module','-e',`
   import './tests/model-chain-fixture.ts';import {chatJson} from '@aihot/backend/providers/llm';import {closeDb} from '@aihot/backend/db';import {z} from 'zod';
   try{const r=await chatJson({model:'intern-flash',purpose:'child-protection',subject:crypto.randomUUID(),promptVersion:'test',system:'JSON',user:'test',schema:z.object({ok:z.boolean()})});if(r.model!=='test-middle')throw Error('wrong layer');}finally{await closeDb();}
  `],{env:process.env});assert.equal(p.hits(),1);assert.equal(m.hits(),3);
  await sql`INSERT INTO budgets(service,per_minute,per_hour,per_day) VALUES('intern',0,0,0)`;
  try{await assert.rejects(ask(),BudgetExceededError);assert.equal(m.hits(),3);assert.equal(f.hits(),0);}
  finally{await sql`DELETE FROM budgets WHERE service='intern'`;}
 });
});
test('expired quota cooldown lets just one recovery probe run; success restores priority',async()=>{
 let recover=false;const release=gate(),entered=gate();
 await providers(async()=>{if(!recover)return new Reply(429,{error:{message:'quota exceeded'}});entered.open();await release.promise;return answer;},()=>answer,async(p,m,f)=>{
  await ask();await sql`UPDATE settings SET value=jsonb_set(value,'{until}','0') WHERE key LIKE 'model.health.%'`;
  recover=true;const probe=ask();await entered.promise;
  try{assert.equal((await ask('intern-flash-think')).model,'test-middle-think');assert.equal(p.hits(),2);}finally{release.open();}
  assert.equal((await probe).model,'intern-flash');assert.equal((await ask()).model,'intern-flash');assert.equal(f.hits(),0);
 });
});
test('temporary server failures and invalid JSON get a free recovery chance before paid',async()=>{
 await providers(()=>new Reply(434,{error:'free allowance exhausted'}),hit=>hit===1?new Reply(502,{error:'server is busy'}):answer,async(p,m,f)=>{
  assert.equal((await ask()).model,'test-middle');assert.deepEqual([p.hits(),m.hits(),f.hits()],[1,2,0]);
 });
 await providers(()=>new Reply(434,{error:'free allowance exhausted'}),hit=>hit===1?{choices:[{message:{content:'not JSON'}}]}:answer,async(p,m,f)=>{
  assert.equal((await ask()).model,'test-middle');assert.deepEqual([p.hits(),m.hits(),f.hits()],[1,2,0]);
 });
});
test('free-layer concurrency waits locally rather than falling to paid',async()=>{
 const release=gate();let active=0,peak=0;
 await providers(()=>answer,async()=>{active++;peak=Math.max(peak,active);try{await release.promise;return answer;}finally{active--; }},async(p,m,f)=>{
  const tasks=Array.from({length:5},()=>ask('test-middle'));
  try{await new Promise(r=>setTimeout(r,8000));assert.equal(m.hits(),3);assert.equal(peak,3);assert.equal(f.hits(),0);}finally{release.open();}
  assert.ok((await Promise.all(tasks)).every(r=>r.model==='test-middle'));assert.equal(peak,3);
 });
});
test('Retry-After is honored without immediate retries and delayed old failures cannot reopen a recovered provider',async()=>{
 assert.equal(retryAfterMs('3'),3000);assert.equal(retryAfterMs('garbage'),null);
 assert.equal(retryAfterMs('Tue, 27 Oct 2026 10:00:00 GMT',Date.parse('2026-10-27T09:59:55Z')),5000);
 assert.equal(failureKind(429,'quota exceeded'),'quota');assert.equal(failureKind(400,'invalid request'),null);
 await providers(()=>new Reply(429,{error:'rate limit'},{'Retry-After':'60'}),()=>answer,async(p,m,f)=>{
  const started=Date.now();assert.equal((await ask()).model,'test-middle');assert.equal(p.hits(),1);assert.equal(f.hits(),0);
  const [row]=await sql`SELECT key,value FROM settings WHERE key LIKE 'model.health.intern.%' AND value->>'reason'='rate'`;
  assert.ok(row!.value.until>=started+60000);
 });
 const scope='intern.watermark-test';
 await sql.begin(tx=>recordModelHealth(tx,'intern',scope,20));
 await sql.begin(tx=>recordModelHealth(tx,'intern',scope,10,{kind:'quota'}));
 const [health]=await sql`SELECT value FROM settings WHERE key=${'model.health.'+scope}`;
 assert.equal(health!.value.failures,0);assert.equal(health!.value.attemptId,20);
});
test('a second-layer recovery probe is allowed to finish before another task buys paid fallback',async()=>{
 let recover=false;const entered=gate(),release=gate();
 await providers(()=>new Reply(434,{error:'free allowance exhausted'}),async()=>{
  if(!recover)return new Reply(434,{error:'free allowance exhausted'});
  entered.open();await release.promise;return answer;
 },async(p,m,f)=>{
  assert.equal((await ask()).model,'deepseek-flash');assert.equal(f.hits(),1);
  await sql`UPDATE settings SET value=jsonb_set(value,'{until}','0') WHERE key LIKE 'model.health.test-middle.%'`;
  recover=true;const probe=ask();await entered.promise;const waiting=ask();
  try{await new Promise(r=>setTimeout(r,500));assert.equal(f.hits(),1);}
  finally{release.open();}
  assert.ok((await Promise.all([probe,waiting])).every(r=>r.model==='test-middle'));assert.equal(f.hits(),1);
 });
});
