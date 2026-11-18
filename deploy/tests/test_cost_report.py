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
SAMPLE = {'start':'2026-10-24 00:00','end':'2026-10-25 00:00','paid_cny':'0.123456',
          'unknown_outcomes':0,'unpriced_paid':0}


class CostReportTests(unittest.TestCase):
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

    def test_mail_contains_only_window_cost_and_uv(self):
        report = {**SAMPLE, 'traffic':{'uvAvailable':True,'uniqueVisitors':1280,'uvComplete':True}}
        msg = reporter.message(report,'sender@example.com','owner@example.com','2026-10-25')
        self.assertEqual(msg.get_content().splitlines(), [
            '2026-10-24 00:00–24:00（北京时间）',
            '模型费用（估算）  0.1235 元',
            '独立访客（估算 UV）  1,280',
        ])
        self.assertEqual(msg['Subject'],'大厂观察｜2026-10-24 费用与 UV')
        self.assertEqual(msg['Message-ID'],'<changji-cost-2026-10-25@innews.site>')
        self.assertEqual(msg['To'],'owner@example.com')
        self.assertIn('大厂观察', msg['From'])

    def test_incomplete_cost_and_unavailable_exchange_rate_are_inlined(self):
        report = {**SAMPLE, 'paid_usd':'0.02', 'unknown_outcomes':2}
        body = reporter.message(report,'sender@example.com','owner@example.com','2026-10-25').get_content()
        self.assertIn('已统计模型费用（估算）  0.1235 元 + 0.0200 美元', body)
        self.assertIn('汇率暂不可用', body)
        self.assertIn('部分调用费用待核对', body)
        self.assertIn('独立访客（估算 UV）  暂无数据', body)
        self.assertEqual(reporter.cost_text('0', '0.02', {}), '0.0200 美元（汇率暂不可用）')

    def test_latest_quote_converts_total_into_cny_without_repeating_breakdowns(self):
        fx = {'available':True,'rate':'7','quoted_at':'2026-10-25T08:59:00+08:00','source':'Yahoo Finance','older_quote':False}
        body = reporter.message({**SAMPLE,'paid_usd':'0.02','fx':fx},'s@e.com','r@e.com','2026-10-25').get_content()
        self.assertEqual(body.splitlines()[1],'模型费用（估算）  0.2635 元')

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

    def test_exchange_rate_tries_an_alternate_endpoint_after_a_transport_error(self):
        with patch.object(reporter.urllib.request,'urlopen',side_effect=[OSError('offline'), self.quote()]) as fetch:
            self.assertEqual(reporter.latest_usd_cny()['rate'],'6.7')
        self.assertEqual([call.args[0].host for call in fetch.call_args_list],
                         ['query1.finance.yahoo.com','query2.finance.yahoo.com'])

    def test_old_but_latest_market_quote_is_marked_as_non_realtime(self):
        with patch.object(reporter.urllib.request,'urlopen',return_value=self.quote(regularMarketTime=int(reporter.datetime.now().timestamp())-2*86400)):
            fx = reporter.latest_usd_cny()
        self.assertTrue(fx['available'])
        body = reporter.message({**SAMPLE,'paid_usd':'0.02','fx':fx},'sender@example.com','owner@example.com','2026-10-30').get_content()
        self.assertIn('按较早汇率折算',body)

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
            self.assertIn('统计备注  '+note,body)
            self.assertNotIn(note,reporter.traffic_report('2026-10-28')['notes'])
        (self.root/'shared/traffic-notes.json').write_text('invalid')
        with patch.object(reporter.subprocess,'check_output',side_effect=OSError()):
            traffic = reporter.traffic_report('2026-10-27')
            body = reporter.message({**SAMPLE,'traffic':traffic},'s@e.com','r@e.com','2026-10-27').get_content()
            self.assertIn('维护备注读取失败',body)
            self.assertIn('独立访客（估算 UV）  暂无数据',body)

    def test_uv_coverage_is_independent_of_pv_and_missing_uv_is_not_zero(self):
        payload = {'views':30,'bots':1,'errors':0,'notFound':0,'pages':{'/all':30},'since':'2026-10-23T16:00:00Z'}
        def read(extra):
            with patch.object(reporter.subprocess,'check_output',return_value=json.dumps({**payload,**extra})):
                return reporter.traffic_report('2026-10-26')
        missing = read({})
        self.assertTrue(missing['complete']);self.assertFalse(missing['uvAvailable'])
        self.assertIn('独立访客（估算 UV）  暂无数据',reporter.message({**SAMPLE,'traffic':missing},'s@e.com','r@e.com','2026-10-26').get_content())
        self.assertFalse(read({'uniqueVisitors':0,'uvSince':'2026-10-25T16:00:00Z'})['uvAvailable'])
        partial = read({'uniqueVisitors':4,'uvSince':'2026-10-25T12:00:00Z'})
        self.assertTrue(partial['complete']);self.assertTrue(partial['uvAvailable']);self.assertFalse(partial['uvComplete'])
        body = reporter.message({**SAMPLE,'traffic':partial},'s@e.com','r@e.com','2026-10-26').get_content()
        self.assertIn('独立访客（估算 UV）  4（仅统计 20:00 起）',body)
        full = read({'uniqueVisitors':0,'uvSince':'2026-10-24T16:00:00Z'})
        self.assertTrue(full['uvAvailable']);self.assertTrue(full['uvComplete']);self.assertEqual(full['uniqueVisitors'],0)
        self.assertIn('独立访客（估算 UV）  0',reporter.message({**SAMPLE,'traffic':full},'s@e.com','r@e.com','2026-10-26').get_content())
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
