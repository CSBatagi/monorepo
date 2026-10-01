"""Filesystem recovery/security checks; runnable on the Windows workstation."""
import importlib.util
import json
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


if __name__ == '__main__':
    unittest.main()
