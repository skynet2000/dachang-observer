import importlib.util
import json
import os
from pathlib import Path
import smtplib
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('cost_report', Path(__file__).parents[1] / 'cost-report.py')
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)
SAMPLE = {'start':'2026-10-24 00:00','end':'2026-10-25 00:00','paid_cny':'0.123456','paid_calls':3,
          'free_success':20,'free_failed':1,'unknown_outcomes':0,'unpriced_paid':0,
          'purposes':[{'purpose':'score_article','calls':3,'cny':0.123456}]}

class CostReportTests(unittest.TestCase):
    def test_free_provider_failures_and_current_cooldown_are_visible(self):
        report = {**SAMPLE, 'model_errors':[{'service':'intern','reason':'quota','count':30}],
                  'provider_health':[{'service':'intern','reason':'quota','until':int(reporter.datetime.now().timestamp()*1000)+3600000}]}
        body = reporter.message(report,'sender@example.com','owner@example.com','2026-10-25').get_content()
        self.assertIn('书生：额度拒绝 30 次',body)
        self.assertIn('当前通道状态（非昨日统计）',body)
        self.assertIn('冷却至',body)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root/'shared').mkdir()
        self.env = patch.dict(os.environ, {'COST_EMAIL_START_DATE':'2000-01-01',
                    'SMTP_FROM':'sender@example.com','COST_EMAIL_TO':'owner@example.com'})
        self.env.start()
        self.root_patch = patch.object(reporter, 'ROOT', self.root)
        self.root_patch.start()
        self.client = MagicMock()
        self.client.__enter__.return_value = self.client

    def tearDown(self):
        self.root_patch.stop()
        self.env.stop()
        self.folder.cleanup()

    def run_send(self):
        with patch('sys.argv',['cost-report.py','--send']), patch.object(reporter.subprocess,'check_output',return_value=json.dumps(SAMPLE)), patch.object(reporter,'smtp',return_value=self.client):
            reporter.main()

    def test_mail_contains_window_estimate_and_purpose_without_secret(self):
        msg = reporter.message(SAMPLE,'sender@example.com','owner@example.com','2026-10-25')
        body = msg.get_content()
        self.assertIn('0.1235 元', body)
        self.assertIn('精选评分', body)
        self.assertIn('2026-10-24 00:00', body)
        self.assertIn('最终以供应商账单为准', body)
        self.assertEqual(msg['To'],'owner@example.com')
        self.assertIn('大厂观察', msg['Subject'])
        self.assertIn('大厂观察', msg['From'])

    def test_scnet_quota_usage_is_separate_from_paid_cny_and_does_not_claim_zero_cost(self):
        report = {**SAMPLE, 'scnet_success':7, 'scnet_failed':2, 'scnet_unknown':1,
                  'scnet_tokens':4567, 'scnet_missing_usage':1}
        body = reporter.message(report,'sender@example.com','owner@example.com','2026-10-25').get_content()
        self.assertIn('成功 7 次；拒绝 2 次；结果未知/进行中 1 次', body)
        self.assertIn('4567 Token', body)
        self.assertIn('缺少可读用量的成功调用 1 次', body)
        self.assertIn('付费通道估算费用：0.1235 元', body)
        self.assertIn('不把未知费用记成0元', body)
        self.assertIn('历史超算 GLM（已停用）', body)
        self.assertIn('书生免费 → 硅基流动 DeepSeek → 推理时代1017 → DeepSeek 官方付费', body)

    def test_siliconflow_priced_usage_is_separate_from_official_deepseek(self):
        report = {**SAMPLE, 'provider_costs':[{'service':'siliconflow','calls':2,'cny':'0.2'}, {'service':'deepseek','calls':1,'cny':'0.1'}]}
        body = reporter.message(report,'sender@example.com','owner@example.com','2026-10-30').get_content()
        self.assertIn('硅基流动：2 次；0.2000 元', body)
        self.assertIn('DeepSeek官方：1 次；0.1000 元', body)
        self.assertIn('硅基流动是有价模型', body)

    def test_usd_without_quote_is_not_pretended_to_be_a_complete_cny_total(self):
        report = {**SAMPLE, 'paid_usd':'0.02','provider_costs':[{'service':'aihubmix','calls':2,'cny':'0','usd':'0.02'}]}
        body = reporter.message(report,'sender@example.com','owner@example.com','2026-10-30').get_content()
        self.assertIn('0.1235 元 + 0.0200 美元', body)
        self.assertIn('人民币合计尚不完整', body)
        self.assertIn('推理时代：2 次；0.0200 美元', body)

    def test_latest_quote_converts_total_provider_and_purpose_without_double_counting(self):
        fx = {'available':True,'rate':'7','quoted_at':'2026-10-30T08:59:00+08:00','source':'Yahoo Finance','older_quote':False}
        report = {**SAMPLE, 'paid_usd':'0.02','fx':fx,
                  'purposes':[{'purpose':'translate_body','calls':3,'cny':'0.123456','usd':'0.02'}],
                  'provider_costs':[{'service':'aihubmix','calls':2,'cny':'0','usd':'0.02'}]}
        body = reporter.message(report,'sender@example.com','owner@example.com','2026-10-30').get_content()
        self.assertIn('统一折合人民币）：约 0.2635 元',body)
        self.assertIn('推理时代：2 次；约 0.1400 元',body)
        self.assertIn('全文翻译：约 0.2635 元',body)
        self.assertIn('2026-10-30T08:59:00+08:00',body)
        self.assertIn('1 美元 = 7 元',body)
        self.assertIn('原美元部分 0.0200 美元',body)

    def quote(self, **changes):
        meta = {'symbol':'CNY=X','currency':'CNY','regularMarketPrice':6.7,
                'regularMarketTime':int(reporter.datetime.now().timestamp())}
        meta.update(changes)
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({'chart':{'result':[{'meta':meta}]}}).encode()
        return response

    def test_latest_quote_is_fetched_and_validates_pair_rate_and_age(self):
        with patch.object(reporter.urllib.request,'urlopen',return_value=self.quote()) as fetch:
            fx = reporter.latest_usd_cny()
        self.assertTrue(fx['available'])
        self.assertEqual(fx['rate'],'6.7')
        self.assertTrue(fx['quoted_at'].endswith('+08:00'))
        self.assertEqual(fetch.call_args.kwargs['timeout'],12)
        for changes in [{'symbol':'CNH=X'},{'regularMarketPrice':-1},{'regularMarketPrice':'NaN'}, {'regularMarketTime':0}]:
            with patch.object(reporter.urllib.request,'urlopen',return_value=self.quote(**changes)):
                self.assertFalse(reporter.latest_usd_cny()['available'])
        with patch.object(reporter.urllib.request,'urlopen',side_effect=OSError('offline')):
            self.assertFalse(reporter.latest_usd_cny()['available'])

    def test_old_but_latest_market_quote_is_marked_as_non_realtime(self):
        with patch.object(reporter.urllib.request,'urlopen',return_value=self.quote(regularMarketTime=int(reporter.datetime.now().timestamp())-2*86400)):
            fx = reporter.latest_usd_cny()
        self.assertTrue(fx['available'])
        body = reporter.message({**SAMPLE,'paid_usd':'0.02','fx':fx},'sender@example.com','owner@example.com','2026-10-30').get_content()
        self.assertIn('较旧行情（非实时）',body)

    def test_sent_report_retains_original_usd_and_the_exchange_quote(self):
        fx = {'available':True,'rate':'7','quoted_at':'2026-10-30T08:59:00+08:00','source':'Yahoo Finance','older_quote':False}
        with patch('sys.argv',['cost-report.py','--send']), patch.object(reporter.subprocess,'check_output',return_value=json.dumps({**SAMPLE,'paid_usd':'0.02'})), patch.object(reporter,'smtp',return_value=self.client), patch.object(reporter,'latest_usd_cny',return_value=fx) as fetch:
            reporter.main()
        fetch.assert_called_once()
        state = json.loads((self.root/'shared/cost-mail-state.json').read_text())
        sent = next(iter(state.values()))
        self.assertEqual(sent['usd'],'0.02')
        self.assertEqual(sent['fx']['rate'],'7')
        self.assertEqual(sent['status'],'sent')

    def test_operating_mail_distinguishes_yesterday_from_rolling_costs_and_partial_coverage(self):
        report = {**SAMPLE, 'traffic': {'day':'2026-10-24','available':True,'views':12,'bots':4,'errors':1,'notFound':2,
                  'since':'2026-10-24T12:00:00+08:00','complete':False,'topPages':[('/all',8),('/',4)]},
                  'operations':{'collected':10,'blocked':3,'published':5,'selected':2,'failing_sources':1,'backlog':0}}
        msg = reporter.message(report,'sender@example.com','owner@example.com','2026-10-25')
        body = msg.get_content()
        self.assertIn('网站运营日报', msg['Subject'])
        self.assertIn('2026-10-24 00:00–24:00', body)
        self.assertIn('页面访问请求：12 次',body)
        self.assertIn('部分时段',body)
        self.assertIn('/all：8 次',body)
        self.assertIn('采集入库：10 篇',body)
        self.assertIn('缺失不代表零访问',reporter.message(SAMPLE,'s@e.com','r@e.com','2026-10-25').get_content())

    def test_section_mail_preserves_uncertainty_instead_of_calling_failures_empty(self):
        report = {**SAMPLE, 'coverage': {'sections': [
            {'label':'裁员与招聘','published':0,'status':'采集覆盖不完整，暂不能判定无稿'},
            {'label':'职场与组织','published':0,'status':'采集处理未见异常，暂未发现合格新稿'}],
            'impaired_sources':1,'backlog':0,'unclassified_workplace':0}}
        body = reporter.message(report, 'sender@example.com', 'reader@example.com', '2026-11-14').get_content()
        self.assertIn('采集覆盖不完整，暂不能判定无稿', body)
        self.assertIn('暂未发现合格新稿', body)

    def test_traffic_day_uses_beijing_midnight_and_missing_history_is_not_zero(self):
        payload = {'views':3,'bots':1,'errors':0,'notFound':0,'pages':{'/all':3},'since':'2026-10-24T16:00:00Z'}
        with patch.object(reporter.subprocess,'check_output',return_value=json.dumps(payload)):
            self.assertFalse(reporter.traffic_report('2026-10-25')['available'])
            r = reporter.traffic_report('2026-10-26')
            self.assertEqual(r['day'],'2026-10-25');self.assertTrue(r['complete'])
        with patch.object(reporter.subprocess,'check_output',side_effect=OSError()):
            self.assertFalse(reporter.traffic_report('2026-10-26')['available'])

    def test_never_send_before_first_day(self):
        with patch.dict(os.environ,{'COST_EMAIL_START_DATE':'2999-01-01'}):
            self.run_send()
        self.client.send_message.assert_not_called()

    def test_maintenance_notes_follow_the_statistics_day_without_changing_counts(self):
        note = '巡检误计552次PV、1个估算UV及1次测试404；按用户选择保留原值。'
        (self.root/'shared/traffic-notes.json').write_text(json.dumps({'2026-10-26':[note]}))
        payload = {'views':600,'bots':10,'errors':0,'notFound':3,'pages':{'/all':600},
                   'since':'2026-10-24T16:00:00Z','uniqueVisitors':8,'uvSince':'2026-10-24T16:00:00Z'}
        with patch.object(reporter.subprocess,'check_output',return_value=json.dumps(payload)):
            traffic = reporter.traffic_report('2026-10-27')
            self.assertEqual(traffic['views'],600);self.assertEqual(traffic['uniqueVisitors'],8)
            self.assertEqual(traffic['bots'],10);self.assertEqual(traffic['notFound'],3)
            body = reporter.message({**SAMPLE,'traffic':traffic},'s@e.com','r@e.com','2026-10-27').get_content()
            self.assertIn('统计备注：'+note,body)
            self.assertNotIn(note,reporter.traffic_report('2026-10-28')['notes'])
        (self.root/'shared/traffic-notes.json').write_text('invalid')
        with patch.object(reporter.subprocess,'check_output',side_effect=OSError()):
            traffic = reporter.traffic_report('2026-10-27')
            body = reporter.message({**SAMPLE,'traffic':traffic},'s@e.com','r@e.com','2026-10-27').get_content()
            self.assertIn('维护备注读取失败',body)
            self.assertIn('缺失不代表零访问',body)

    def test_uv_coverage_is_independent_of_pv_and_missing_uv_is_not_zero(self):
        payload = {'views':30,'bots':1,'errors':0,'notFound':0,'pages':{'/all':30},'since':'2026-10-23T16:00:00Z'}
        def read(extra):
            with patch.object(reporter.subprocess,'check_output',return_value=json.dumps({**payload,**extra})):
                return reporter.traffic_report('2026-10-26')
        missing = read({})
        self.assertTrue(missing['complete']);self.assertFalse(missing['uvAvailable'])
        self.assertIn('缺失不代表零访客',reporter.message({**SAMPLE,'traffic':missing},'s@e.com','r@e.com','2026-10-26').get_content())
        self.assertFalse(read({'uniqueVisitors':0,'uvSince':'2026-10-25T16:00:00Z'})['uvAvailable'])
        partial = read({'uniqueVisitors':4,'uvSince':'2026-10-25T12:00:00Z'})
        self.assertTrue(partial['complete']);self.assertTrue(partial['uvAvailable']);self.assertFalse(partial['uvComplete'])
        body = reporter.message({**SAMPLE,'traffic':partial},'s@e.com','r@e.com','2026-10-26').get_content()
        self.assertIn('独立访客（UV）：4',body);self.assertIn('仅覆盖部分时段',body)
        full = read({'uniqueVisitors':0,'uvSince':'2026-10-24T16:00:00Z'})
        self.assertTrue(full['uvAvailable']);self.assertTrue(full['uvComplete']);self.assertEqual(full['uniqueVisitors'],0)
        self.assertFalse(read({'uniqueVisitors':31,'uvSince':'2026-10-24T16:00:00Z'})['uvAvailable'])
        self.assertFalse(read({'uniqueVisitors':True,'uvSince':'2026-10-24T16:00:00Z'})['uvAvailable'])
        invalid = read({'uniqueVisitors':2,'uvSince':'invalid'})
        self.assertTrue(invalid['available']);self.assertFalse(invalid['uvAvailable'])

    def test_success_is_deduplicated(self):
        self.run_send()
        self.run_send()
        self.client.send_message.assert_called_once()

    def test_ambiguous_delivery_is_not_resent(self):
        self.client.send_message.side_effect = smtplib.SMTPServerDisconnected('connection lost')
        with self.assertRaises(smtplib.SMTPServerDisconnected):
            self.run_send()
        with self.assertRaises(RuntimeError):
            self.run_send()
        self.client.send_message.assert_called_once()

    def test_explicit_rejection_can_retry(self):
        self.client.send_message.side_effect = [smtplib.SMTPDataError(451,b'temporary rejection'),{}]
        with self.assertRaises(smtplib.SMTPDataError):
            self.run_send()
        self.run_send()
        self.assertEqual(self.client.send_message.call_count,2)

if __name__ == '__main__':
    unittest.main()
