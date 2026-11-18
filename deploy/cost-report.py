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
 SELECT r.service,a.status,a.cost,a.currency
 FROM receipt_attempts a JOIN receipts r ON r.id=a.receipt_id
 WHERE a.origin='live' AND a.model IS NOT NULL
 AND a.started_at >= (SELECT start_at FROM bounds) AND a.started_at < (SELECT end_at FROM bounds)
)
SELECT json_build_object(
 'start',(SELECT start_at FROM bounds) AT TIME ZONE 'Asia/Shanghai',
 'end',(SELECT end_at FROM bounds) AT TIME ZONE 'Asia/Shanghai',
 'paid_cny',coalesce(sum(cost) FILTER(WHERE currency='CNY'),0)::text,
 'paid_usd',coalesce(sum(cost) FILTER(WHERE currency='USD'),0)::text,
 'unknown_outcomes',count(*) FILTER(WHERE service NOT IN ('intern','scnet') AND status IN('unknown','pending')),
 'unpriced_paid',count(*) FILTER(WHERE service NOT IN ('intern','scnet') AND status='received' AND (cost IS NULL OR currency IS NULL OR currency NOT IN ('CNY','USD')))
) FROM calls;
"""


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
        quote = '（按较早汇率折算）' if fx.get('older_quote') else ''
        return f'{money(total)} 元{quote}'
    return f'{money(cny)} 元 + {money(usd)} 美元（汇率暂不可用）'


def message(report, sender, recipient, day):
    msg = EmailMessage()
    msg['From'] = formataddr(('大厂观察', sender))
    msg['To'] = recipient
    stats_day = datetime.fromisoformat(report['start']).date().isoformat()
    msg['Subject'] = f'大厂观察｜{stats_day} 费用与 UV'
    msg['Message-ID'] = f'<changji-cost-{day}@innews.site>'
    msg['Date'] = format_datetime(datetime.now(ZoneInfo('Asia/Shanghai')))

    cost = cost_text(report['paid_cny'], report.get('paid_usd', 0), report.get('fx', {}))
    cost_label = '模型费用（估算）'
    if report['unknown_outcomes'] or report['unpriced_paid']:
        cost_label = '已统计模型费用（估算）'
        cost += '（部分调用费用待核对）'
    traffic = report.get('traffic', {})
    uv = '暂无数据'
    if traffic.get('uvAvailable'):
        uv = f"{traffic['uniqueVisitors']:,}"
        if not traffic['uvComplete']:
            since = datetime.fromisoformat(traffic['uvSince'])
            uv += f'（仅统计 {since:%H:%M} 起）'

    rows = [f'{stats_day} 00:00–24:00（北京时间）', f'{cost_label}  {cost}', f'独立访客（估算 UV）  {uv}']
    rows.extend(f'统计备注  {note}' for note in traffic.get('notes', []))
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
    report['traffic'] = traffic_report(datetime.fromisoformat(report['end']).date().isoformat())
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
