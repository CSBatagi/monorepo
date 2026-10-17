"""SDR persistence and admission checks, without changing the live game or secrets."""
import importlib.util
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest import mock


def load(name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sdr = load('sdr')
gate = load('connection-gate')
VALVE = '''"GameInfo"
{
    FileSystem { ForceFixedAppIds 1 SteamAppId 730 BreakpadAppId 2347771 }
    Panorama { "PreprocessResources" "1" }
    ConVars { "cl_usesocketsforloopback" "0" }
    // Preserve Valve's values, nested content and comments.
}
'''


class SdrTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def test_adds_settings_idempotently_without_replacing_valve_app_identity(self):
        result = sdr.configured(VALVE, True)
        self.assertEqual(result, sdr.configured(result, True))
        self.assertIn('SteamAppId 730', result)
        self.assertIn('BreakpadAppId 2347771', result)
        self.assertIn('"PreprocessResources" "1"', result)
        self.assertIn('// Preserve Valve', result)
        self.assertIn('"net_p2p_listen_dedicated" "1"', result)
        self.assertIn('"CreateListenSocketP2P" "2"', result)

    def test_updates_existing_blocks_and_supports_operator_disable(self):
        source = VALVE.replace('ConVars {', 'NetworkSystem { Other 4 CreateListenSocketP2P 0 }\n ConVars { net_p2p_listen_dedicated 0')
        result = sdr.configured(source, True)
        self.assertEqual(result.count('NetworkSystem'), 1)
        self.assertEqual(result.count('net_p2p_listen_dedicated'), 1)
        self.assertIn('Other 4', result)
        disabled = sdr.configured(result, False)
        self.assertIn('net_p2p_listen_dedicated "0"', disabled)
        self.assertIn('CreateListenSocketP2P "0"', disabled)

    def test_handles_missing_convars_quoted_sections_and_nested_blocks(self):
        source = VALVE.replace('ConVars { "cl_usesocketsforloopback" "0" }', '')
        source = source.replace('FileSystem {', '"FileSystem" { Nested { Value "}" }')
        result = sdr.configured(source, True)
        self.assertEqual(result, sdr.configured(result, True))
        self.assertIn('Nested { Value "}" }', result)

    def test_refuses_unknown_app_identity_malformed_or_duplicate_sections(self):
        for source in [VALVE.replace('730', '240'), VALVE[:-3], VALVE.replace('ConVars {', 'ConVars {} ConVars {')]:
            with self.assertRaises(RuntimeError):
                sdr.configured(source, True)

    def test_prepare_reapplies_after_steamcmd_overwrite_and_keeps_unconfigured_defaults(self):
        game = self.root / 'game'; game.mkdir()
        path = game / 'gameinfo_branchspecific.gi'; path.write_text(VALVE)
        with mock.patch.object(sdr, 'GAME', game), mock.patch.object(sdr, 'ROOT', self.root):
            sdr.prepare(); self.assertEqual(path.read_text(), VALVE)
            (self.root / 'sdr-enabled').write_text('1')
            sdr.prepare(); self.assertIn('CreateListenSocketP2P', path.read_text())
            path.write_text(VALVE)
            sdr.prepare(); self.assertIn('CreateListenSocketP2P', path.read_text())

    def test_reports_only_dialable_anonymous_relay_identity(self):
        status = 'hostname : Club\nsteamid  : [A:1:2392563733:51945] (90295097016164373)\n'
        self.assertEqual(sdr.relay_address(status), '[A:1:2392563733:51945]')
        self.assertEqual(sdr.relay_address('STEAMID : [A:1:12345:7]\n'), '[A:1:12345:7]')
        # A token login's [G:...] is dialed as instance 1 by CS2 clients and never connects.
        for console in ['steamid : [G:1:12345] (85568392932930573)', 'steamid : [G:1:12345:0]',
                        'steamid : [A:1:12345]', 'steamid : [a:1:12345:7]', 'steamid : [U:1:12345:1]',
                        'steamid : [A:1:0:7]', 'player : [A:1:12345:7]', 'steamid : [A:1:12345:7];quit']:
            self.assertIsNone(sdr.relay_address(console))

    def test_every_map_applies_the_password_gate_last_without_replacing_operator_config(self):
        before = 'hostname "Club"\nexec csbatagi_secrets.cfg\n// Operator voice policy\nsv_alltalk 0\n'
        result = sdr.gate_config(before)
        self.assertEqual(result, before + 'exec csbatagi_startup_gate.cfg\n')
        self.assertEqual(result, sdr.gate_config(result))
        self.assertTrue(sdr.gate_config(result + 'exec csbatagi_secrets.cfg\n').endswith('exec csbatagi_startup_gate.cfg\n'))

    def test_validation_requires_enabled_listener_and_steam_identity(self):
        with mock.patch.object(sdr, 'enabled', return_value=True):
            self.assertEqual(sdr.validate(lambda cmd: 'net_p2p_listen_dedicated = true' if cmd != 'status' else 'steamid : [A:1:12345:7]'), {'address': '[A:1:12345:7]'})
            with self.assertRaisesRegex(RuntimeError, 'token_login_unreachable'):
                sdr.validate(lambda cmd: 'net_p2p_listen_dedicated = true' if cmd != 'status' else 'steamid : [G:1:12345] (85568392932930573)')
            for value in ['net_p2p_listen_dedicated = false', 'net_p2p_listen_dedicated = false (default 1)', 'Unknown command']:
                with self.assertRaisesRegex(RuntimeError, 'listener_not_enabled'):
                    sdr.validate(lambda cmd: value)
            with self.assertRaisesRegex(RuntimeError, 'identity_unavailable'):
                sdr.validate(lambda cmd: 'net_p2p_listen_dedicated = true')

    def test_stale_or_absent_ready_marker_never_reports_a_relay(self):
        boot = self.root / 'boot'; boot.write_text('new-boot')
        ready = self.root / 'ready'
        with mock.patch.object(sdr, 'BOOT', boot), mock.patch.object(sdr, 'READY', ready), mock.patch.object(sdr, 'validate') as validate:
            self.assertIsNone(sdr.report(mock.Mock()))
            ready.write_text('old-boot'); self.assertIsNone(sdr.report(mock.Mock()))
            validate.assert_not_called()
            ready.write_text('new-boot'); validate.return_value = {'address': '[A:1:12345:7]'}
            self.assertEqual(sdr.report(mock.Mock()), {'address': '[A:1:12345:7]'})

    def test_token_moves_out_of_club_secrets_once_and_losslessly(self):
        game = self.root / 'game'; (game / 'cfg').mkdir(parents=True)
        secrets = game / 'cfg/csbatagi_secrets.cfg'
        secrets.write_text('sv_password "club"\nsv_setsteamaccount "TESTTOKEN"\nrcon_password "admin"\n')
        secrets.chmod(0o640)
        with mock.patch.object(sdr, 'GAME', game):
            self.assertTrue(sdr.separate_token())
            self.assertEqual(secrets.read_text(), 'sv_password "club"\nrcon_password "admin"\n')
            token = game / 'cfg/csbatagi_steam_token.cfg'
            self.assertEqual(token.read_text(), 'sv_setsteamaccount "TESTTOKEN"\n')
            if os.name != 'nt':
                self.assertEqual(token.stat().st_mode & 0o777, 0o640)
                self.assertEqual(secrets.stat().st_mode & 0o777, 0o640)
            self.assertFalse(sdr.separate_token())  # Re-running the installer changes nothing.
            # An interruption after the token copy is finished by the next run.
            secrets.write_text('sv_password "club"\nsv_setsteamaccount "TESTTOKEN"\n')
            self.assertTrue(sdr.separate_token())
            self.assertEqual(secrets.read_text(), 'sv_password "club"\n')
            secrets.write_text('sv_setsteamaccount "OTHER"\n')
            with self.assertRaisesRegex(RuntimeError, 'token_conflict'):
                sdr.separate_token()
            secrets.write_text('sv_setsteamaccount "A"\nsv_setsteamaccount "B"\n')
            with self.assertRaisesRegex(RuntimeError, 'token_ambiguous'):
                sdr.separate_token()

    def test_launch_uses_the_token_only_without_the_relay(self):
        launch = load('launch')
        classic = launch.arguments('cs2', False)
        relay = launch.arguments('cs2', True)
        self.assertIn('csbatagi_steam_token.cfg', classic)
        self.assertNotIn('csbatagi_steam_token.cfg', relay)
        for args in [classic, relay]:
            self.assertLess(args.index('csbatagi_secrets.cfg'), args.index('server.cfg'))
            self.assertEqual(args[-3:], ['csbatagi_startup_gate.cfg', '+map', 'de_dust2'])
        token = classic.index('csbatagi_steam_token.cfg')
        self.assertEqual(classic[token - 1], '+exec')
        self.assertLess(classic.index('csbatagi_secrets.cfg'), token)  # Token applies after the secrets.
        self.assertEqual(classic[:token - 1] + classic[token + 1:], relay)
        with mock.patch.object(launch, 'ROOT', self.root):
            self.assertFalse(launch.relay_enabled())
            (self.root / 'sdr-enabled').write_text('0\n'); self.assertFalse(launch.relay_enabled())
            (self.root / 'sdr-enabled').write_text('1\n'); self.assertTrue(launch.relay_enabled())

    def test_gate_opens_only_after_current_boot_verification_and_relay_validation(self):
        game = self.root / 'game'; (game / 'cfg').mkdir(parents=True)
        (game / 'cfg/csbatagi_secrets.cfg').write_text('sv_password "test-only-club-password"\n')
        boot = self.root / 'boot'; boot.write_text('new-boot')
        ready = self.root / 'run/ready'
        state = self.root / 'status.json'
        command = mock.Mock()
        modules = {'rcon-local': mock.Mock(command=command), 'sdr': mock.Mock()}
        with mock.patch.object(gate, 'ROOT', self.root), mock.patch.object(gate, 'GAME', game), mock.patch.object(gate, 'BOOT', boot), mock.patch.object(gate, 'READY', ready), mock.patch.object(gate, 'local_module', side_effect=lambda name: modules[name]), mock.patch.object(gate, 'write_gate') as write_gate:
            for value in [{'stage': 'verifying', 'bootId': 'new-boot'}, {'stage': 'ready', 'bootId': 'old-boot'}]:
                state.write_text(json.dumps(value))
                with self.assertRaises(RuntimeError): gate.open_gate()
            command.assert_not_called()
            state.write_text(json.dumps({'stage': 'ready', 'bootId': 'new-boot'}))
            modules['sdr'].validate.side_effect = RuntimeError('relay_unavailable')
            with self.assertRaises(RuntimeError): gate.open_gate()
            self.assertFalse(ready.exists()); command.assert_not_called()
            modules['sdr'].validate.side_effect = None
            ready.parent.mkdir(mode=0o700)
            original_chmod = pathlib.Path.chmod
            previous_umask = os.umask(0o027)
            try:
                with mock.patch.object(pathlib.Path, 'chmod', autospec=True, side_effect=original_chmod) as chmod:
                    gate.open_gate()
                    chmod.assert_any_call(ready.parent, 0o755)
            finally:
                os.umask(previous_umask)
            if os.name != 'nt':
                self.assertEqual(ready.parent.stat().st_mode & 0o777, 0o755)
            command.assert_called_once_with('sv_password "test-only-club-password"')
            write_gate.assert_called_once_with('test-only-club-password')
            self.assertEqual(ready.read_text(), 'new-boot')

    def test_rejects_empty_duplicate_and_injecting_password_configuration(self):
        for config in ['sv_password ""', 'sv_password "test;quit"', 'sv_password "one"\nsv_password "two"', '']:
            with self.assertRaises(RuntimeError): gate.club_password(config)

    def test_close_removes_readiness_and_rotates_a_private_startup_password(self):
        game = self.root / 'game'; (game / 'cfg').mkdir(parents=True)
        ready = self.root / 'ready'; ready.write_text('old-boot')
        pwd = types.SimpleNamespace(getpwnam=lambda name: types.SimpleNamespace(pw_uid=1000, pw_gid=1000))
        command = mock.Mock(side_effect=ConnectionError('not listening'))
        with mock.patch.object(gate, 'GAME', game), mock.patch.object(gate, 'READY', ready), mock.patch.object(gate.os, 'chown', create=True), mock.patch.dict('sys.modules', {'pwd': pwd}), mock.patch.object(gate, 'local_module', return_value=mock.Mock(command=command)):
            gate.close()
            path = game / 'cfg/csbatagi_startup_gate.cfg'
            first = path.read_text()
            self.assertRegex(first, r'^sv_password "[a-f0-9]{64}"\n$')
            self.assertFalse(ready.exists())
            gate.close()
            self.assertNotEqual(path.read_text(), first)


if __name__ == '__main__':
    unittest.main()
