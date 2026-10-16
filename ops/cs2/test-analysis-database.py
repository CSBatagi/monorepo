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
