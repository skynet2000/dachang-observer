#!/usr/bin/env python3
"""Read yesterday's Beijing-day model ledger; send one private SMTP report per Beijing day."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import smtplib
import ssl
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta
from decimal import Decimal
from email.message import EmailMessage
from email.utils import formataddr, format_datetime
from zoneinfo import ZoneInfo

ROOT = Path('/home/ubuntu/changji-observer')
QUERY = """
WITH bounds AS (SELECT (date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai')-interval '1 day') AT TIME ZONE 'Asia/Shanghai' AS start_at, date_trunc('day',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' AS end_at), calls AS (
 SELECT r.service,r.purpose,a.status,a.cost,a.currency,a.usage,a.error
 FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
 WHERE a.origin='live' AND a.model IS NOT NULL
 AND a.started_at >= (SELECT start_at FROM bounds) AND a.started_at < (SELECT end_at FROM bounds)
)
SELECT json_build_object(
 'start',(SELECT start_at FROM bounds) AT TIME ZONE 'Asia/Shanghai',
 'end',(SELECT end_at FROM bounds) AT TIME ZONE 'Asia/Shanghai',
 'paid_cny',coalesce(sum(cost) FILTER(WHERE currency='CNY'),0)::text,
 'paid_usd',coalesce(sum(cost) FILTER(WHERE currency='USD'),0)::text,
 'paid_calls',count(*) FILTER(WHERE service NOT IN ('intern','scnet')),
 'provider_costs',(SELECT coalesce(json_agg(p),'[]'::json) FROM (SELECT service,count(*) AS calls,coalesce(sum(cost) FILTER(WHERE currency='CNY'),0)::text AS cny,coalesce(sum(cost) FILTER(WHERE currency='USD'),0)::text AS usd FROM calls WHERE service IN ('siliconflow','aihubmix','deepseek') GROUP BY service) p),
 'free_success',count(*) FILTER(WHERE service='intern' AND status='received'),
 'free_failed',count(*) FILTER(WHERE service='intern' AND status='failed'),
 'unknown_outcomes',count(*) FILTER(WHERE service NOT IN ('intern','scnet') AND status IN('unknown','pending')),
 'unpriced_paid',count(*) FILTER(WHERE service NOT IN ('intern','scnet') AND status='received' AND (cost IS NULL OR currency IS NULL OR currency NOT IN ('CNY','USD'))),
 'scnet_success',count(*) FILTER(WHERE service='scnet' AND status='received'),
 'scnet_failed',count(*) FILTER(WHERE service='scnet' AND status='failed'),
 'scnet_unknown',count(*) FILTER(WHERE service='scnet' AND status IN('unknown','pending')),
 'scnet_tokens',coalesce(sum(CASE WHEN jsonb_typeof(usage->'total_tokens')='number' THEN greatest((usage->>'total_tokens')::numeric,0) ELSE 0 END) FILTER(WHERE service='scnet'),0),
 'scnet_missing_usage',count(*) FILTER(WHERE service='scnet' AND status='received' AND (usage IS NULL OR jsonb_typeof(usage->'total_tokens') IS DISTINCT FROM 'number')),
 'model_errors',(SELECT coalesce(json_agg(e),'[]'::json) FROM (
   SELECT service,CASE WHEN error ILIKE '%quota%' OR error LIKE '%HTTP 402%' OR error LIKE '%HTTP 434%' THEN 'quota'
     WHEN error LIKE '%HTTP 429%' THEN 'rate' WHEN status IN ('unknown','pending') THEN 'unknown'
     WHEN error ~ 'HTTP 5[0-9][0-9]' THEN 'server' ELSE 'other' END AS reason,count(*) AS count
   FROM calls WHERE service IN ('intern','scnet','siliconflow','aihubmix') AND status<>'received' GROUP BY 1,2) e),
 'provider_health',(SELECT coalesce(json_agg(json_build_object('service',split_part(key,'.',3),
   'reason',value->>'reason','until',value->'until')),'[]'::json) FROM settings
   WHERE key LIKE 'model.health.%' AND (value->>'failures')::int>0),
 'operations',json_build_object(
  'collected',(SELECT count(*) FROM articles WHERE discovered_at>=(SELECT start_at FROM bounds) AND discovered_at<(SELECT end_at FROM bounds)),
  'blocked',(SELECT count(*) FROM articles WHERE discovered_at>=(SELECT start_at FROM bounds) AND discovered_at<(SELECT end_at FROM bounds) AND processing_state='blocked'),
  'published',(SELECT count(*) FROM publications WHERE discovered_at>=(SELECT start_at FROM bounds) AND discovered_at<(SELECT end_at FROM bounds) AND visibility='public' AND eligible AND (NOT selected OR visible_after<=now())),
  'selected',(SELECT count(*) FROM publications WHERE discovered_at>=(SELECT start_at FROM bounds) AND discovered_at<(SELECT end_at FROM bounds) AND visibility='public' AND eligible AND selected AND visible_after<=now()),
  'failing_sources',(SELECT count(*) FROM sources WHERE enabled AND health='failing'),
  'backlog',(SELECT count(*) FROM articles WHERE processing_state='new' AND discovered_at<now()-interval '2 hours' AND discovered_at>now()-interval '2 days')),
 'purposes',(SELECT coalesce(json_agg(p ORDER BY p.cny DESC),'[]'::json) FROM
   (SELECT purpose,count(*) AS calls,coalesce(sum(cost) FILTER(WHERE currency='CNY'),0) AS cny,coalesce(sum(cost) FILTER(WHERE currency='USD'),0) AS usd
    FROM calls WHERE service NOT IN ('intern','scnet') GROUP BY purpose) p)
) FROM calls;
"""
LABELS = {'maintenance.category4':'历史四栏准入与分类复核', 'maintenance.category4.confirm':'疑似无关报道二次复核', 'prefilter_article':'行业预筛','score_article':'精选评分','understand_article':'内容理解',
          'summarize_article':'标题与摘要','structure_article':'结构抽取','mend_wording':'措辞修订',
          'group_article':'报道归组','group_review':'归组复核','group_story':'事件合并',
          'group_story_review':'事件合并复核','group_signal':'热点信号归组','story_digest':'事件综述',
          'language.english':'中英文翻译','translate_body':'全文翻译','translate_quoted':'引用翻译',
          'maintenance.prefilter.round3':'第三轮准入开发回归','maintenance.score.round3':'第三轮评分开发回归',
          'maintenance.prefilter.boundary':'准入开发回归','maintenance.selection.holdout':'独立验收预筛','maintenance.group.history':'历史归组复核',
          'report_weekly':'周报','report_monthly':'月报','ops.priority_probe':'通道验收'}


def money(value):
    return f'{Decimal(str(value)):.4f}'


def latest_usd_cny():
    """Fetch latest available USD/CNY market quote; never silently reuse a cached rate."""
    try:
        request = urllib.request.Request('https://query1.finance.yahoo.com/v8/finance/chart/CNY=X?interval=1m&range=1d', headers={'User-Agent':'DachangObserver/1.0'})
        with urllib.request.urlopen(request, timeout=12) as response:
            meta = json.loads(response.read(2000000))['chart']['result'][0]['meta']
        now = datetime.now(ZoneInfo('UTC'))
        rate = Decimal(str(meta['regularMarketPrice']))
        quoted = datetime.fromtimestamp(meta['regularMarketTime'], ZoneInfo('UTC'))
        age = (now - quoted).total_seconds()
        if meta['symbol'] != 'CNY=X' or meta['currency'] != 'CNY' or not rate.is_finite() or rate <= 0 or age < -300 or age > 4*86400:
            raise ValueError('Invalid or stale USD/CNY quote')
        return {'available':True,'rate':str(rate),'quoted_at':quoted.astimezone(ZoneInfo('Asia/Shanghai')).isoformat(),
                'fetched_at':now.isoformat(),'source':'Yahoo Finance USD/CNY https://finance.yahoo.com/quote/CNY=X/',
                'older_quote':age>86400}
    except (OSError, ValueError, KeyError, TypeError, IndexError, ArithmeticError):
        return {'available':False,'reason':'汇率接口失败、无有效报价或报价已过期'}


def cost_text(cny, usd, fx):
    cny, usd = Decimal(str(cny)), Decimal(str(usd))
    if usd == 0:
        return f'{money(cny)} 元'
    if fx.get('available'):
        total = cny + usd * Decimal(fx['rate'])
        return f'约 {money(total)} 元（原美元部分 {money(usd)} 美元）'
    return (f'{money(cny)} 元 + ' if cny else '') + f'{money(usd)} 美元（汇率不可用，尚未折算）'


def message(report, sender, recipient, day):
    msg = EmailMessage()
    msg['From'] = formataddr(('大厂观察', sender))
    msg['To'] = recipient
    msg['Subject'] = f'大厂观察｜网站运营日报｜{day}'
    msg['Message-ID'] = f'<changji-cost-{day}@innews.site>'
    msg['Date'] = format_datetime(datetime.now(ZoneInfo('Asia/Shanghai')))
    fx = report.get('fx', {})
    rows = [f"统一统计窗口（北京时间）：{report['start']} 至 {report['end']}",
            f"付费通道估算费用：{money(report['paid_cny'])} 元", f"付费通道尝试：{report['paid_calls']} 次",
            f"书生免费通道成功：{report['free_success']} 次；拒绝：{report['free_failed']} 次", '', '费用用途：']
    rows.extend(f"- {LABELS.get(p['purpose'], p['purpose'])}：{cost_text(p['cny'], p.get('usd', 0), fx)}，{p['calls']} 次" for p in report['purposes'])
    if Decimal(str(report.get('paid_usd', 0))) > 0:
        rows[1] = '付费通道估算费用（统一折合人民币）：' + cost_text(report['paid_cny'], report['paid_usd'], fx)
        if fx.get('available'):
            quote_label = '较旧行情（非实时）' if fx.get('older_quote') else '最新可得行情（可能延迟）'
            rows.insert(2, f"汇率：1 美元 = {fx['rate']} 元；{quote_label}，报价时间 {fx['quoted_at']}；来源 {fx['source']}。仅用于估算，不等于充值结算汇率。")
        else:
            rows.insert(2, '汇率获取失败：人民币合计尚不完整，原始美元费用保留；不按0元处理。')
    if not report['purposes']:
        rows.append('- 本窗口没有付费通道调用。')
    if report['unknown_outcomes'] or report['unpriced_paid']:
        rows += ['', f"待核对：{report['unknown_outcomes']} 次调用结果未知/进行中，{report['unpriced_paid']} 次成功调用缺少可信价格。未知结果可能保留费用上界。"]
    if any(report.get(k, 0) for k in ('scnet_success', 'scnet_failed', 'scnet_unknown')):
        rows += ['', f"历史超算 GLM（已停用）：成功 {report.get('scnet_success', 0)} 次；拒绝 {report.get('scnet_failed', 0)} 次；结果未知/进行中 {report.get('scnet_unknown', 0)} 次",
                 f"超算已返回用量：{report.get('scnet_tokens', 0)} Token；缺少可读用量的成功调用 {report.get('scnet_missing_usage', 0)} 次。",
                 '超算按调用回执统计 Token，不是平台剩余额度或已核实现金账单；不把未知费用记成0元。']
    providers = {'intern':'书生','scnet':'超算','siliconflow':'硅基流动','deepseek':'DeepSeek官方','aihubmix':'推理时代'}
    rows += ['', '有价通道分别统计（估算，不等于账户实际扣款）：']
    rows.extend(f"- {providers.get(p['service'],p['service'])}：{p['calls']} 次；{cost_text(p['cny'],p.get('usd',0),fx)}。" for p in report.get('provider_costs', []))
    reasons = {'quota':'额度拒绝','rate':'限流','unknown':'结果未知/进行中','server':'上游服务错误','other':'其他失败'}
    rows += ['', '昨日优先通道及历史超算异常（尝试次数，重试分别计数）：']
    rows.extend(f"- {providers.get(e['service'],e['service'])}：{reasons.get(e['reason'],e['reason'])} {e['count']} 次" for e in report.get('model_errors', []))
    if not report.get('model_errors'): rows.append('- 本窗口没有记录到优先通道及历史超算异常。')
    rows += ['', '当前通道状态（非昨日统计）：']
    for h in report.get('provider_health', []):
        until = datetime.fromtimestamp(h['until']/1000, ZoneInfo('Asia/Shanghai'))
        state = f"冷却至 {until:%m-%d %H:%M:%S}" if until > datetime.now(ZoneInfo('Asia/Shanghai')) else '等待单条恢复探测'
        rows.append(f"- {providers.get(h['service'],h['service'])}：{reasons.get(h['reason'],h['reason'])}，{state}。")
    if not report.get('provider_health'): rows.append('- 当前无持久化冷却，实际可用性仍以调用结果为准。')
    rows += ['', '当前策略：书生免费 → 硅基流动 DeepSeek → 推理时代1017 → DeepSeek 官方付费；前一层失败才进入下一层。硅基流动是有价模型，赠送余额抵扣以平台账单为准。',
             '已确认不可用的免费层在冷却期间暂时跳过；恢复探测成功后重新优先。并发排队不触发付费，超时未知不在原层盲重发。',
             '成功数表示收到模型回复，不保证通过全部业务校验；冷却跳过不会记作一次模型请求。',
             '以上来自本站调用回执，按既有价格估算；最终以供应商账单为准。',
             '不含同一密钥在其他项目的调用、服务器费用、书生墨点换算或未核实的超算现金账单。此报告生成不调用模型。']
    traffic = report.get('traffic', {})
    rows += ['', f"昨日访问（北京时间）：{traffic.get('day', '未取得')} 00:00–24:00"]
    if traffic.get('available'):
        rows += [f"页面访问请求：{traffic['views']} 次（排除已识别爬虫；不是独立访客数）",
                 f"已识别爬虫/自动化请求：{traffic['bots']} 次；页面5xx错误：{traffic['errors']} 次；404：{traffic['notFound']} 次",
                 f"统计启用时间：{traffic['since']}；{'完整自然日' if traffic['complete'] else '仅覆盖启用后的部分时段'}。", '热门页面：']
        rows.extend(f"- {page}：{count} 次" for page, count in traffic['topPages'])
        if not traffic['topPages']: rows.append('- 本统计时段暂无成功页面请求。')
        if traffic.get('uvAvailable'):
            rows += [f"估算独立访客（UV）：{traffic['uniqueVisitors']}；{'完整自然日' if traffic['uvComplete'] else '仅覆盖部分时段'}，覆盖起点：{traffic['uvSince']}。"]
        else:
            rows.append('UV未启用、无对应历史记录或读取失败；缺失不代表零访客。')
        rows += ['UV按每日随机密钥计算的连接地址与浏览器标识去重；不是准确人数，共享网络可能合并，切换网络或浏览器可能重复。',
                 '不保存原始IP/浏览器标识，不设置统计Cookie，不关联登录账号；完全从缓存读取且未请求服务器的页面可能漏计。']
    else:
        rows.append('访问统计未启用、无历史记录或读取失败；缺失不代表零访问。')
    rows.extend(f'统计备注：{note}' for note in traffic.get('notes', []))
    ops = report.get('operations')
    if ops:
        rows += ['', '昨日内容产出与当前运行状态：',
                 f"采集入库：{ops['collected']} 篇；准入阻止：{ops['blocked']} 篇；公开报道：{ops['published']} 篇；精选：{ops['selected']} 篇。",
                 f"当前连续失败信源：{ops['failing_sources']} 个；等待超2小时：{ops['backlog']} 篇。"]
    coverage = report.get('coverage')
    rows += ['', '昨日栏目产出与采集检查：']
    if coverage and isinstance(coverage.get('sections'), list):
        rows.extend(f"- {row['label']}：{row['published']} 篇；{row['status']}。" for row in coverage['sections'])
        rows.append(f"当前覆盖异常信源：{coverage['impaired_sources']}；积压：{coverage['backlog']}；昨日未分类职场稿：{coverage['unclassified_workplace']}。")
        rows.append('栏目篇数按原文发布时间统计；积压和信源状态为邮件发送时状态，不能把缺失数据当作零。')
    else:
        rows.append('栏目检查读取失败；缺失不代表无新稿。')
    rows += ['', '访问信息只做站内匿名聚合，不调用模型；故障与恢复通知仍单独及时发送。']
    msg.set_content('\n'.join(rows))
    return msg


def save_state(path, state):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False))
    temp.chmod(0o600)
    temp.replace(path)


def smtp():
    required = ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','COST_EMAIL_TO']
    if any(not os.environ.get(key) for key in required):
        raise ValueError('SMTP configuration incomplete')
    client = smtplib.SMTP_SSL(os.environ['SMTP_HOST'], int(os.environ.get('SMTP_PORT','465')),
                             timeout=30, context=ssl.create_default_context())
    try:
        client.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'].replace(' ',''))
    except Exception:
        client.close()
        raise
    return client


def traffic_report(day):
    yesterday = (datetime.fromisoformat(day).date() - timedelta(days=1)).isoformat()
    result = {'day': yesterday, 'available': False}
    try:
        notes = json.loads((ROOT/'shared/traffic-notes.json').read_text()).get(yesterday, [])
        if not isinstance(notes, list) or any(not isinstance(note, str) for note in notes):
            raise ValueError('Invalid traffic notes')
        result['notes'] = notes
    except FileNotFoundError:
        pass
    except (OSError, ValueError, AttributeError):
        result['notes'] = ['维护备注读取失败，请检查服务器 shared/traffic-notes.json；访问数字未作校正。']
    try:
        # Read only the private aggregate volume; never query cookies, addresses or raw access logs.
        script = "const f=require('fs');const dir=process.env.ACCESS_STATS_DIR;if(!dir)process.exit(2);const since=JSON.parse(f.readFileSync(dir+'/started.json')).since;let uvSince;try{uvSince=JSON.parse(f.readFileSync(dir+'/uv-started.json')).since;}catch(e){if(e.code!=='ENOENT')throw e;}let d;try{d=JSON.parse(f.readFileSync(dir+'/'+process.argv[1]+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;d={views:0,bots:0,errors:0,notFound:0,pages:{},uniqueVisitors:0};}console.log(JSON.stringify({...d,uvSince:d.uvSince??uvSince,since}));"
        raw = subprocess.check_output(['docker','compose','exec','-T','web','node','-e',script,yesterday], cwd=ROOT/'current', text=True, stderr=subprocess.DEVNULL, timeout=20)
        data = json.loads(raw)
        since = datetime.fromisoformat(data['since'].replace('Z','+00:00'))
        start = datetime.fromisoformat(yesterday).replace(tzinfo=ZoneInfo('Asia/Shanghai'))
        if since >= start + timedelta(days=1): return result
        counts = {k: data[k] for k in ('views','bots','errors','notFound')}
        if any(not isinstance(n,int) or isinstance(n,bool) or n<0 for n in counts.values()): return result
        pages = data['pages']
        if not isinstance(pages,dict) or any(not isinstance(k,str) or not isinstance(v,int) or v<0 for k,v in pages.items()): return result
        result = {**result, **counts, 'available': True, 'since': since.astimezone(ZoneInfo('Asia/Shanghai')).isoformat(),
                  'complete': since<=start, 'topPages': sorted(pages.items(), key=lambda p: (-p[1],p[0]))[:5], 'uvAvailable': False}
        unique = data.get('uniqueVisitors')
        if isinstance(unique,int) and not isinstance(unique,bool) and 0<=unique<=counts['views'] and data.get('uvSince'):
            try:
                uv_since = datetime.fromisoformat(data['uvSince'].replace('Z','+00:00'))
            except (ValueError, TypeError, AttributeError):
                return result
            if uv_since.utcoffset() is None: return result
            if uv_since < start + timedelta(days=1):
                result.update(uniqueVisitors=unique, uvAvailable=True, uvComplete=uv_since<=start,
                              uvSince=max(start,uv_since).astimezone(ZoneInfo('Asia/Shanghai')).isoformat())
        return result
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, TypeError):
        return result


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--send', action='store_true')
    mode.add_argument('--check-login', action='store_true')
    mode.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.check_login:
        with smtp():
            print('SMTP login verified; no email sent.')
        return
    day = datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
    if args.send and day < os.environ['COST_EMAIL_START_DATE']:
        print('Before configured first report date; no email sent.')
        return
    report = json.loads(subprocess.check_output(['docker','compose','exec','-T','db','psql','-U','aihot','-d','aihot','-Atc',QUERY], cwd=ROOT/'current', text=True))
    try:
        script = """
import {coverageSnapshot} from './site/modules/coverage.ts';
import {closeDb} from './packages/backend/src/db.ts';
const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const end=new Date(day+'T00:00:00+08:00');
try {console.log(JSON.stringify(await coverageSnapshot(new Date(end.getTime()-86400000),end)));}
finally {await closeDb();}
"""
        report['coverage'] = json.loads(subprocess.check_output(
            ['docker','compose','exec','-T','api','node','--input-type=module','-e',script],
            cwd=ROOT/'current', text=True, timeout=90))
    except (subprocess.SubprocessError, OSError, ValueError):
        report['coverage'] = None
    report['traffic'] = traffic_report(day)
    if Decimal(str(report.get('paid_usd', 0))) > 0:
        report['fx'] = latest_usd_cny()
    if not args.send:
        print(message(report, os.environ.get('SMTP_FROM','operator@example.com'),
                      os.environ.get('COST_EMAIL_TO','operator@example.com'), day).as_string())
        return
    state_path = ROOT/'shared/cost-mail-state.json'
    with state_path.with_suffix('.lock').open('w') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        if state.get(day, {}).get('status') == 'sent':
            print('Already sent today; no duplicate email.')
            return
        if state.get(day, {}).get('status') in ('sending','unknown'):
            raise RuntimeError('Previous delivery outcome unknown; check mailbox before retrying')
        with smtp() as client:
            msg = message(report, os.environ['SMTP_FROM'], os.environ['COST_EMAIL_TO'], day)
            state = {k:v for k,v in sorted(state.items())[-34:]}
            state[day] = {'status':'sending','cny':report['paid_cny'],'usd':report.get('paid_usd','0'),'fx':report.get('fx'),'window_end':report['end']}
            save_state(state_path, state)
            try:
                client.send_message(msg, to_addrs=[os.environ['COST_EMAIL_TO']])
            except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused):
                state[day]['status'] = 'rejected'
                save_state(state_path, state)
                raise
            except Exception:
                state[day]['status'] = 'unknown'
                save_state(state_path, state)
                raise
            state[day]['status'] = 'sent'
            save_state(state_path, state)
            print(f"Cost report accepted by SMTP: {day}, CNY {money(report['paid_cny'])}")


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No SMTP response bodies, environment values or credential-bearing tracebacks in logs.
        print(f'Cost report failed: {type(error).__name__}', file=sys.stderr)
        sys.exit(1)
