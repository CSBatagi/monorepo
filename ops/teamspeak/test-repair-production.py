"""Verify routine deployment never needs bootstrap access or touches roles."""
import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('repair', pathlib.Path(__file__).with_name('repair-production.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class RoutineRefreshTests(unittest.TestCase):
    def test_refresh_works_without_bootstrap_credentials_or_role_commands(self):
        with tempfile.TemporaryDirectory(prefix='csbatagi-query-refresh-') as directory:
            root = pathlib.Path(directory).resolve()
            self.assertTrue(root.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve()))
            (root / '.teamspeak_secrets').touch()
            (root / '.csbatagi-teamspeak-ops').mkdir()
            commands = []
            def run(args, **kwargs):
                commands.append(args)
                data = 'backend-id\n' if args[1] == 'ps' else json.dumps([{'NetworkSettings': {'Networks': {'db2': {'IPAddress': '172.18.0.20', 'Gateway': '172.18.0.1'}}}}]) if args[1] == 'inspect' else ''
                return subprocess.CompletedProcess(args, 0, stdout=data)
            output = io.StringIO()
            with patch.object(repair.pathlib.Path, 'home', return_value=root), patch.object(repair.sys, 'argv', ['repair', '--allowlist-only']), patch.object(repair.subprocess, 'run', side_effect=run), contextlib.redirect_stdout(output):
                repair.main()
            self.assertEqual((root / '.csbatagi-teamspeak-ops/query-ip-allowlist.txt').read_text().splitlines(), ['127.0.0.1', '::1', '172.18.0.20', '172.18.0.1'])
            self.assertEqual([args[1] for args in commands], ['ps', 'inspect', 'cp', 'cp'])
            self.assertNotIn('credential', output.getvalue())
            self.assertFalse((root / '.teamspeak_server_secrets').exists())

    def test_website_without_teamspeak_configuration_needs_no_docker_access(self):
        with tempfile.TemporaryDirectory(prefix='csbatagi-query-disabled-') as directory:
            root = pathlib.Path(directory).resolve()
            self.assertTrue(root.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve()))
            with patch.object(repair.pathlib.Path, 'home', return_value=root), patch.object(repair.sys, 'argv', ['repair', '--allowlist-only']), patch.object(repair.subprocess, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
                repair.main()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
