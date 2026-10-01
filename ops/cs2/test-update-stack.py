"""Filesystem recovery/security checks; runnable on the Windows workstation."""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
import zipfile
from unittest import mock

if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location('updates', pathlib.Path(__file__).with_name('update-stack.py'))
updates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updates)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        updates.ROOT = pathlib.Path(self.temp.name) / 'updates'
        updates.STATE = updates.ROOT / 'status.json'
        updates.GAME = pathlib.Path(self.temp.name) / 'game'
        updates.ROOT.mkdir(); updates.GAME.mkdir()
        (updates.GAME / 'steam.inf').write_text('PatchVersion=1.2.3\nServerVersion=123\n')

    def tearDown(self):
        self.temp.cleanup()

    def test_archive_escape_is_rejected(self):
        archive = updates.ROOT / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as out:
            out.writestr('../private.cfg', 'bad')
        with self.assertRaisesRegex(RuntimeError, 'archive_path'):
            updates.extract(archive, updates.ROOT / 'unpack')
        self.assertFalse((updates.ROOT / 'private.cfg').exists())

    def test_package_preserves_configs_credentials_and_restores_previous_files(self):
        payload = updates.ROOT / 'payload'
        files = {'addons/counterstrikesharp/plugins/MatchZy/MatchZy.dll': 'new',
                 'addons/counterstrikesharp/plugins/MatchZy/new-dependency.dll': 'added',
                 'addons/counterstrikesharp/configs/admins.json': 'overwrite',
                 'cfg/csbatagi_secrets.cfg': 'overwrite'}
        for rel, data in files.items():
            path = payload / rel; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(data)
        plugin = updates.GAME / 'addons/counterstrikesharp/plugins/MatchZy/MatchZy.dll'
        plugin.parent.mkdir(parents=True); plugin.write_text('previous')
        secret = updates.GAME / 'cfg/csbatagi_secrets.cfg'
        secret.parent.mkdir(); secret.write_text('private')
        updates.install_package({'payload': str(payload), 'versions': {'matchzy': 'v2'}})
        self.assertEqual(plugin.read_text(), 'new')
        self.assertEqual(secret.read_text(), 'private')
        self.assertFalse((updates.GAME / 'addons/counterstrikesharp/configs/admins.json').exists())
        updates.rollback()
        self.assertEqual(plugin.read_text(), 'previous')
        self.assertFalse(plugin.with_name('new-dependency.dll').exists())
        self.assertEqual(secret.read_text(), 'private')

    def test_depot_version_mismatch_blocks_launch(self):
        updates.HOME = pathlib.Path(self.temp.name)
        manifest = updates.HOME / 'cs2/steamapps/appmanifest_730.acf'
        manifest.parent.mkdir(parents=True); manifest.write_text('"buildid" "123"')
        with mock.patch.object(updates, 'public_build', return_value='124'):
            with self.assertRaisesRegex(RuntimeError, 'game_version_not_current'):
                updates.current_game(check_remote=True)

    def test_interrupted_verification_restores_trusted_stack_without_quarantining_candidate(self):
        payload = updates.ROOT / 'payload'
        rel = pathlib.Path('addons/counterstrikesharp/plugins/MatchZy/MatchZy.dll')
        (payload / rel).parent.mkdir(parents=True); (payload / rel).write_text('candidate')
        (updates.GAME / rel).parent.mkdir(parents=True); (updates.GAME / rel).write_text('trusted')
        updates.install_package({'payload': str(payload), 'versions': {'matchzy': 'v2'}})
        self.assertTrue((updates.ROOT / 'pending.json').exists())
        updates.rollback(reject=False)
        self.assertEqual((updates.GAME / rel).read_text(), 'trusted')
        self.assertFalse((updates.ROOT / 'rejected.json').exists())

    def test_inventory_outage_restores_package_without_quarantining_it(self):
        payload = updates.ROOT / 'payload'
        rel = pathlib.Path('addons/counterstrikesharp/plugins/MatchZy/MatchZy.dll')
        (payload / rel).parent.mkdir(parents=True); (payload / rel).write_text('candidate')
        (updates.GAME / rel).parent.mkdir(parents=True); (updates.GAME / rel).write_text('trusted')
        updates.install_package({'payload': str(payload), 'versions': {'matchzy': 'v2'}})
        updates.atomic_json(updates.STATE, {'stage': 'failed', 'error': 'inventory_health'})
        updates.rollback()
        self.assertEqual((updates.GAME / rel).read_text(), 'trusted')
        self.assertFalse((updates.ROOT / 'rejected.json').exists())

    def run_verification(self, plugins, api_recovers_at):
        elapsed = [0]
        self.verification_elapsed = elapsed
        stages = []
        check = updates.GAME / 'csbatagi-state/inventory-check.json'
        def command(value):
            if value == 'csbatagi_status':
                return json.dumps({'cstv': True, 'warmup': True})
            if value == 'css_plugins list':
                return plugins
            if value == 'csbatagi_inventory_check' and elapsed[0] >= api_recovers_at:
                updates.atomic_json(check, {'success': True})
                os.utime(check, (1000 + elapsed[0], 1000 + elapsed[0]))
            return ''
        with mock.patch.object(updates, 'rcon', return_value=command), \
             mock.patch.object(updates, 'current_game', return_value={'buildId': '123'}), \
             mock.patch.object(updates, 'probe_demo'), \
             mock.patch.object(updates, 'stage', side_effect=lambda name, **kwargs: stages.append(name)), \
             mock.patch.object(updates.time, 'monotonic', side_effect=lambda: elapsed[0]), \
             mock.patch.object(updates.time, 'time', side_effect=lambda: 1000 + elapsed[0]), \
             mock.patch.object(updates.time, 'sleep', side_effect=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds)):
            updates.verify()
        return elapsed[0], stages

    def test_api_can_recover_after_native_startup_window(self):
        elapsed, stages = self.run_verification('[#1:LOADED]: "MatchZy"\n[#2:LOADED]: "InventorySimulator"', 200)
        self.assertGreaterEqual(elapsed, 200)
        self.assertEqual(stages[-1], 'ready')

    def test_native_plugin_failure_does_not_wait_for_api_budget(self):
        with self.assertRaisesRegex(RuntimeError, 'plugin_health'):
            self.run_verification('[#1:FAILED]: "MatchZy"', 200)
        self.assertEqual(self.verification_elapsed[0], 150)


if __name__ == '__main__':
    unittest.main()
