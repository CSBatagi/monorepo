import importlib.util
import json
import pathlib
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


worker = module('worker', 'demo-analyzer.py')
production = module('production', 'analysis-database-production.py')


class QueueProtectionTests(unittest.TestCase):
    def test_database_outage_leaves_jobs_queued(self):
        with patch.object(worker, 'game_report', return_value={'running': True}), \
             patch.object(worker, 'database_ready', return_value=False), \
             patch.object(worker, 'inventory', return_value=[]), \
             patch.object(worker, 'api', return_value={'jobs': [{'name': 'real.dem'}]}) as api, \
             patch.object(worker, 'analyze') as analyze:
            worker.run_once()
            api.assert_not_called()
            analyze.assert_not_called()

    def test_database_recovery_processes_the_queued_job(self):
        with patch.object(worker, 'game_report', return_value={'running': True}), \
             patch.object(worker, 'database_ready', return_value=True), \
             patch.object(worker, 'inventory', return_value=[]), \
             patch.object(worker, 'api', return_value={'jobs': [{'name': 'real.dem'}]}) as api, \
             patch.object(worker, 'analyze', return_value='done') as analyze:
            worker.run_once()
            analyze.assert_called_once_with({'name': 'real.dem'})
            self.assertEqual([call.args[1].get('state') for call in api.call_args_list], [None, 'analyzing', 'analyzed'])

    def test_live_match_remains_protected(self):
        with patch.object(worker, 'game_report', return_value={'running': True, 'live': True}), \
             patch.object(worker, 'database_ready') as database, \
             patch.object(worker, 'inventory', return_value=[]), \
             patch.object(worker, 'api', return_value={'jobs': [{'name': 'real.dem'}]}) as api, \
             patch.object(worker, 'analyze') as analyze:
            worker.run_once()
            self.assertTrue(api.call_args.args[1]['busy'])
            database.assert_not_called()
            analyze.assert_not_called()

    def test_database_check_handles_failure_timeout_and_recovery_without_secret_arguments(self):
        with tempfile.TemporaryDirectory() as folder:
            config = pathlib.Path(folder) / '.config/csdm/settings.json'
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'database': {'hostname': '127.0.0.1', 'port': 15432,
                'username': 'analyzer', 'password': 'private-test-value', 'database': 'test'}}))
            results = [types.SimpleNamespace(returncode=1, stdout=''),
                       subprocess.TimeoutExpired('psql', 5), types.SimpleNamespace(returncode=0, stdout='1\n')]
            with patch.object(worker.pathlib.Path, 'home', return_value=pathlib.Path(folder)), \
                 patch.object(worker.subprocess, 'run', side_effect=results) as run:
                self.assertFalse(worker.database_ready())
                self.assertFalse(worker.database_ready())
                self.assertTrue(worker.database_ready())
                self.assertNotIn('private-test-value', ' '.join(run.call_args.args[0]))
                self.assertEqual(run.call_args.kwargs['env']['PGPASSWORD'], 'private-test-value')


GO_PANIC = '''nextByte: insufficient buffer (701 of 701)
stacktrace:
goroutine 23 [running]:
runtime/debug.Stack()
\truntime/debug/stack.go:26 +0x5e
github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs.NewParserWithConfig.func1({0x7ba900, 0xc000ce4690})
\tgithub.com/markus-wa/demoinfocs-golang/v4@v4.5.1/pkg/demoinfocs/parser.go:406 +0x2a
panic({0x7ba900?, 0xc000ce4690?})
\truntime/panic.go:791 +0x132
github.com/markus-wa/demoinfocs-golang/v4/pkg/demoinfocs/sendtables2.(*reader).nextByte(0xc0007a60c0)
\tgithub.com/markus-wa/demoinfocs-golang/v4@v4.5.1/pkg/demoinfocs/sendtables2/reader.go:38 +0xc8
reflect.Value.Call({0x767c20?, 0xc0000b27b0?, 0x40e322?}, {0xc0004bfef0?, 0x0?, 0x90ffffffffffffff?})
\treflect/value.go:368 +0xb9
github.com/markus-wa/godispatch.(*Dispatcher).dispatchQueue(0xc000090b40, 0xc00034ca10)
\tgithub.com/markus-wa/godispatch@v1.4.1/dispatch.go:177 +0xd0
created by github.com/markus-wa/godispatch.(*Dispatcher).AddQueues in goroutine 1
\tgithub.com/markus-wa/godispatch@v1.4.1/dispatch.go:162 +0x17f
''' + '\n'.join(f'github.com/x/y.(*Z).f{i}(0xc0001049c0, {{0x864420, 0xc000272a00}})\n\tgithub.com/x/y@v1/z.go:{i} +0x3f'
                for i in range(40))


class ErrorSummaryTests(unittest.TestCase):
    """The website shows this summary; on 17 November 2026 it showed only the end of a Go stack."""

    def test_csdm_3_20_parser_crash_keeps_the_message(self):
        output = ('1 demos to process\nAnalyzing demo /d/nuke.dem...\nError analyzing demo: /d/nuke.dem:\n'
                  + GO_PANIC + '\nundefined')
        summary = worker.error_summary(output)
        self.assertIn('nextByte: insufficient buffer (701 of 701)', summary)
        self.assertIn('Error analyzing demo: /d/nuke.dem:', summary)
        for noise in ('github.com/', 'goroutine', 'stacktrace:', 'panic(', '.go:', 'undefined', 'created by'):
            self.assertNotIn(noise, summary)

    def test_csdm_3_21_failed_demo_block_keeps_the_message(self):
        details = '\n'.join('    ' + line for line in GO_PANIC.splitlines())
        output = ('1 demos to process\nFailed to analyze nuke.dem\n✔ 0 analyzed · ✖ 1 failed\n'
                  'Failed demos:\n  /d/nuke.dem\n' + details)
        summary = worker.error_summary(output)
        self.assertIn('Failed to analyze nuke.dem', summary)
        self.assertIn('nextByte: insufficient buffer (701 of 701)', summary)
        self.assertNotIn('github.com/', summary)

    def test_node_errors_keep_their_messages(self):
        output = ('Error while migrating database\nerror: permission denied for table rounds\n'
                  '    at Parser.parseErrorMessage (/opt/x/node_modules/pg-protocol/dist/parser.js:283:98)\n'
                  '  length: 99,\n  hint: undefined,\n')
        summary = worker.error_summary(output)
        self.assertEqual(summary, 'Error while migrating database\nerror: permission denied for table rounds\nlength: 99,')

    def test_summary_stays_short(self):
        self.assertLessEqual(len(worker.error_summary('message line\n' * 500)), 700)


class ComposeRepairTests(unittest.TestCase):
    def test_only_the_new_service_is_added_and_repeat_apply_is_stable(self):
        source = (HERE.parent.parent / 'docker-compose.yml').read_text()
        before = 'services:\n  cs2-rcon-tunnel:\n    image: keep-rcon\n  backend:\n    image: keep-backend\n  postgres:\n    image: keep-postgres\n'
        after = production.patch_compose(before, source)
        self.assertTrue(after.endswith(before[before.index('  cs2-rcon-tunnel:'):]))
        self.assertEqual(production.patch_compose(after, source), after)
        self.assertEqual(after.count('  cs2-analysis-db-tunnel:\n'), 1)
        self.assertNotIn('    ports:', after[:after.index('  cs2-rcon-tunnel:')])

    def test_unknown_host_layout_is_refused(self):
        source = (HERE.parent.parent / 'docker-compose.yml').read_text()
        with self.assertRaises(ValueError):
            production.patch_compose('services:\n  other:\n    image: anything\n', source)


if __name__ == '__main__':
    unittest.main()
