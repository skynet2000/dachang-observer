#!/usr/bin/env python3
"""Host-side fault/recovery email, independent of the application worker."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import smtplib
import subprocess
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import format_datetime
from urllib.request import urlopen
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location('cost_report', Path(__file__).with_name('cost-report.py'))
mail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mail)
ROOT = mail.ROOT
CHECK = """
import {collectFindings} from './packages/backend/src/operations/alerts.ts';
import {sql,closeDb} from './packages/backend/src/db.ts';
import {installModules} from './packages/backend/src/modules.ts';
import {SERVER_MODULES} from './site/modules/server.ts';
installModules(SERVER_MODULES);
try {
 const findings=(await collectFindings()).filter(f=>f.level==='now'||f.level==='today');
 const [hb]=await sql`SELECT updated_at FROM settings WHERE key='heartbeat.worker'`;
 if(!hb||Date.now()-hb.updated_at.getTime()>30*60_000)
  findings.push({key:'worker.heartbeat',title:'后台处理服务心跳中断超过30分钟',action:'检查 worker 日志及任务队列'});
 console.log(JSON.stringify(findings.map(({key,title,impact,action})=>({key,title,impact,action}))));
}finally{await closeDb();}
"""


def command(*args):
    return subprocess.check_output(args, cwd=ROOT/'current', text=True, timeout=90, stderr=subprocess.DEVNULL)


def probe():
    findings = {}
    try:
        with urlopen('http://127.0.0.1:3000/api/health', timeout=15) as response:
            if response.status != 200:
                raise RuntimeError('health status')
    except Exception:
        findings['site.health'] = {'title':'网站健康检查失败', 'action':'检查 web、api 和数据库服务'}
    try:
        rows = command('docker','compose','ps','--all','--format','json')
        services = [json.loads(line) for line in rows.splitlines() if line.strip()]
        states = {row['Service']:row for row in services}
        for name in ('api','worker','web','db','caddy'):
            row = states.get(name, {})
            if row.get('State') != 'running' or row.get('Health') == 'unhealthy':
                findings['service.'+name] = {'title':name+' 服务停止或不健康', 'action':'检查对应容器日志'}
    except Exception:
        findings['host.docker'] = {'title':'容器状态检查失败', 'action':'检查 Docker 服务'}
    try:
        for row in json.loads(command('docker','compose','exec','-T','api','node','--input-type=module','-e',CHECK)):
            findings[row['key']] = row
    except Exception:
        findings['tasks.inspect'] = {'title':'后台任务状态无法读取', 'action':'检查 API 与数据库连接'}
    for service in ('changji-backup.service','changji-cost-mail.service'):
        try:
            if command('systemctl','show',service,'--property=Result','--value').strip() not in ('success',''):
                findings[service] = {'title':('自动备份' if 'backup' in service else '费用日报邮件')+'任务失败',
                                     'action':'检查 '+service+' 的系统日志'}
        except Exception:
            findings[service] = {'title':service+' 状态无法读取', 'action':'检查 systemd 服务'}
    backups = list((ROOT/'backups/automatic').glob('daily-*/SHA256SUMS'))
    if not backups or datetime.now().timestamp()-max(p.stat().st_mtime for p in backups)>30*3600:
        findings['backup.stale'] = {'title':'超过30小时没有成功的本机备份', 'action':'检查备份任务及磁盘容量'}
    return findings


def transition(state, findings):
    previous = state.get('active', {})
    streaks = {key:state.get('streaks', {}).get(key, 0)+1 for key in findings}
    active = {key:row for key,row in findings.items() if key in previous or streaks[key]>=2}
    raised = {key:row for key,row in active.items() if key not in previous}
    recovered = {key:row for key,row in previous.items() if key not in findings}
    return {**state, 'streaks':streaks, 'active':active}, raised, recovered


def message(raised, recovered, sender, recipient, at):
    msg = EmailMessage()
    msg['From'] = sender
    msg['To'] = recipient
    msg['Date'] = format_datetime(at)
    msg['Subject'] = f'大厂观察｜运行异常 {len(raised)} 项 · 恢复 {len(recovered)} 项'
    msg['Message-ID'] = f'<changji-ops-{at.strftime("%Y%m%d%H%M%S%f")}@innews.site>'
    lines = ['检查时间（北京时间）：'+at.strftime('%Y-%m-%d %H:%M:%S')]
    for label, rows in (('异常', raised), ('恢复', recovered)):
        for row in rows.values():
            lines.append(f'\n{label}：{row["title"]}')
            if label == '异常':
                lines.extend(str(row[key]) for key in ('impact','action') if row.get(key))
    lines += ['', '异常连续两次检查后提醒；相同异常持续存在时不重复发信，恢复后再通知。',
              '该监测运行在服务器上。整台服务器断电、失联或 Gmail 不可用时，无法保证及时发出邮件。']
    msg.set_content('\n'.join(lines))
    return msg


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--send', action='store_true')
    args = parser.parse_args()
    if not args.send:
        print(json.dumps(probe(), ensure_ascii=False))
        return
    state_path = ROOT/'shared/ops-mail-state.json'
    with state_path.with_suffix('.lock').open('w') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        if state.get('delivery') in ('sending','unknown'):
            raise RuntimeError('Previous delivery outcome unknown; check mailbox before retrying')
        next_state, raised, recovered = transition(state, probe())
        if not raised and not recovered:
            mail.save_state(state_path, next_state)
            print('No new fault or recovery; no email sent.')
            return
        with mail.smtp() as client:
            msg = message(raised, recovered, os.environ['SMTP_FROM'], os.environ['COST_EMAIL_TO'], datetime.now(ZoneInfo('Asia/Shanghai')))
            mail.save_state(state_path, {**state, 'delivery':'sending'})
            try:
                client.send_message(msg, to_addrs=[os.environ['COST_EMAIL_TO']])
            except (smtplib.SMTPResponseException, smtplib.SMTPRecipientsRefused):
                mail.save_state(state_path, {**state, 'delivery':'rejected'})
                raise
            except Exception:
                mail.save_state(state_path, {**state, 'delivery':'unknown'})
                raise
            mail.save_state(state_path, {**next_state, 'delivery':'sent'})
            print(f'Operations email accepted by SMTP: {len(raised)} faults, {len(recovered)} recoveries.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Operations email failed: {type(error).__name__}', file=sys.stderr)
        sys.exit(1)
