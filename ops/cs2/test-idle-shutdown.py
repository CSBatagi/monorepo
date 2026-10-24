"""Idle shutdown decisions and probes; runnable on the Windows workstation (python ops/cs2/test-idle-shutdown.py)."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('idle', pathlib.Path(__file__).with_name('idle-shutdown.py'))
idle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(idle)

CONFIG = idle.load_config({})
BOOT = 'boot-a'
WALL = 1_800_000_000.0


def obs(**overrides):
    """An empty, healthy, idle server: CS2 ready with nobody on it, uploads verified."""
    value = {
        'wall': WALL, 'bootId': BOOT, 'cs2Process': True, 'gameSource': 'rcon',
        'units': {'cs2.service': ('active', 'running'), 'csbatagi-demos.service': ('active', 'running'),
                  'apt-daily.service': ('inactive', 'dead'), 'apt-daily-upgrade.service': ('inactive', 'dead')},
        'processes': [{'pid': 10, 'comm': 'cs2', 'argv': ['/home/steam/cs2/game/bin/linuxsteamrt64/cs2', '-dedicated']},
                      {'pid': 11, 'comm': 'python3', 'argv': ['/usr/bin/python3', '/usr/local/lib/csbatagi/update-stack.py', 'report']},
                      {'pid': 12, 'comm': 'python3', 'argv': ['/usr/bin/python3', '/usr/local/lib/csbatagi/demo-analyzer.py']},
                      {'pid': 13, 'comm': 'unattended-upgr', 'argv': ['/usr/bin/python3', '/usr/share/unattended-upgrades/unattended-upgrade-shutdown', '--wait-for-signal']},
                      {'pid': 14, 'comm': 'sshd', 'argv': ['sshd: csbatagi@notty']}],
        'game': {'humans': 0, 'bots': 0, 'live': False, 'preparing': False, 'recording': False, 'matchStarted': False,
                 'demoFailed': False, 'matchLoaded': False, 'matchId': -1},
        'uploads': {'pending': 0, 'updatedAt': WALL - 10},
        'update': {'stage': 'ready', 'bootId': BOOT, 'updatedAt': WALL - 600},
        'ssh': [], 'downloads': [],
    }
    for key, item in overrides.items():
        if key == 'game_fields':
            value['game'] = {**value['game'], **item}
        elif key == 'extra_processes':
            value['processes'] = value['processes'] + item
        elif key == 'unit_states':
            value['units'] = {**value['units'], **item}
        else:
            value[key] = item
    return value


def reasons(observation, config=CONFIG, last_match=None):
    hard, soft, notes, match_id = idle.classify(observation, config, last_match)
    return hard, soft


class ClassifyTests(unittest.TestCase):
    def test_empty_ready_server_is_idle(self):
        hard, soft, notes, _ = idle.classify(obs(), CONFIG)
        self.assertEqual((hard, soft), ([], []))
        self.assertIn('cs2 active, 0 players, 0 bots (rcon)', notes)

    def test_humans_are_activity_and_bots_are_not(self):
        self.assertEqual(reasons(obs(game_fields={'humans': 0, 'bots': 5})), ([], []))
        hard, _ = reasons(obs(game_fields={'humans': 1, 'bots': 5}))
        self.assertEqual(hard, ['1 player on the server'])
        hard, _ = reasons(obs(game_fields={'humans': 10, 'live': True, 'recording': True}))
        self.assertEqual(hard, ['10 players on the server'])

    def test_match_states_without_players_are_holds(self):
        # The website's stop guard: live, preparing, recording; plus started and failed demos.
        for flag in ['live', 'preparing', 'recording', 'matchStarted', 'demoFailed']:
            with self.subTest(flag=flag):
                hard, soft = reasons(obs(game_fields={flag: True}))
                self.assertEqual(hard, [])
                self.assertEqual(soft, [f'match {flag} with no players'])

    def test_newly_loaded_match_resets_once(self):
        observation = obs(game_fields={'matchLoaded': True, 'matchId': 42})
        hard, soft, _, match_id = idle.classify(observation, CONFIG, None)
        self.assertEqual((hard, soft, match_id), (['match 42 loaded'], [], 42))
        hard, soft, _, match_id = idle.classify(observation, CONFIG, 42)
        self.assertEqual((hard, soft, match_id), ([], [], 42))
        _, _, _, match_id = idle.classify(obs(), CONFIG, 42)
        self.assertIsNone(match_id)

    def test_unreadable_status_of_running_cs2_is_a_hold(self):
        hard, soft = reasons(obs(game=None, gameSource='rcon ConnectionRefusedError, status file missing or stale'))
        self.assertEqual(hard, [])
        self.assertEqual(soft, ['cs2 status unreadable (rcon ConnectionRefusedError, status file missing or stale)'])

    def test_status_file_fallback_still_counts_players_and_is_named(self):
        hard, _, notes, _ = idle.classify(obs(gameSource='status file', game_fields={'humans': 2}), CONFIG)
        self.assertEqual(hard, ['2 players on the server'])
        self.assertIn('cs2 active, 2 players, 0 bots (status file)', notes)

    def test_stopped_or_failed_cs2_is_not_activity(self):
        for state in [('failed', 'failed'), ('inactive', 'dead')]:
            with self.subTest(state=state):
                hard, soft, notes, _ = idle.classify(
                    obs(unit_states={'cs2.service': state}, cs2Process=False, game=None, gameSource=None), CONFIG)
                self.assertEqual((hard, soft), ([], []))
                self.assertIn(f'cs2 {state[0]}, not running', notes)

    def test_stray_cs2_process_without_status_is_a_hold(self):
        _, soft = reasons(obs(unit_states={'cs2.service': ('inactive', 'dead')}, game=None, gameSource='rcon OSError'))
        self.assertEqual(soft, ['cs2 status unreadable (rcon OSError)'])

    def test_cs2_startup_and_stop_are_activity(self):
        for state, expected in [(('activating', 'start-pre'), 'cs2 starting (start-pre: updates/verification)'),
                                (('activating', 'start-post'), 'cs2 starting (start-post: updates/verification)'),
                                (('activating', 'auto-restart'), 'cs2 starting (auto-restart: updates/verification)'),
                                (('deactivating', 'stop'), 'cs2 deactivating')]:
            with self.subTest(state=state):
                hard, _ = reasons(obs(unit_states={'cs2.service': state}, game=None))
                self.assertEqual(hard, [expected])

    def test_unreadable_systemd_state_is_a_hold(self):
        _, soft = reasons(obs(units={}, cs2Process=False, game=None))
        self.assertIn('cs2.service state unreadable', soft)

    def test_update_stage_of_this_boot_is_activity(self):
        hard, _ = reasons(obs(update={'stage': 'updating_game', 'bootId': BOOT, 'updatedAt': WALL - 900}))
        self.assertEqual(hard, ['game update stage updating_game'])
        for update in [{'stage': 'updating_game', 'bootId': 'old-boot', 'updatedAt': WALL - 60},
                       {'stage': 'verifying', 'bootId': BOOT, 'updatedAt': WALL - 4000},
                       {'stage': 'failed', 'bootId': BOOT, 'updatedAt': WALL - 60},
                       {'stage': 'checking', 'bootId': BOOT, 'updatedAt': 'garbage'},
                       None]:
            with self.subTest(update=update):
                self.assertEqual(reasons(obs(update=update)), ([], []))

    def test_update_and_maintenance_processes_are_activity(self):
        cases = [
            ({'comm': 'steamcmd', 'argv': ['/home/steam/.local/share/Steam/steamcmd/linux32/steamcmd', '+login', 'anonymous']}, 'steamcmd running'),
            ({'comm': 'dotnet', 'argv': ['/home/steam/csbatagi-updates/dotnet/dotnet', 'publish']}, 'plugin build (dotnet) running'),
            ({'comm': 'python3', 'argv': ['/usr/bin/python3', '/usr/local/lib/csbatagi/update-stack.py', 'prepare']}, 'update-stack prepare'),
            ({'comm': 'python3', 'argv': ['/usr/bin/python3', '/usr/local/lib/csbatagi/update-stack.py', 'verify']}, 'update-stack verify'),
            ({'comm': 'apt-get', 'argv': ['apt-get', 'install', '-y', 'x']}, 'package manager running (apt-get)'),
            ({'comm': 'dpkg', 'argv': ['/usr/bin/dpkg', '--status-fd', '43', '--configure']}, 'package manager running (dpkg)'),
            ({'comm': 'unattended-upgr', 'argv': ['/usr/bin/python3', '/usr/bin/unattended-upgrade']}, 'package manager running (unattended-upgrade)'),
            ({'comm': 'cs-demo-manager', 'argv': ['/opt/cs-demo-manager/cs-demo-manager', '/opt/cs-demo-manager/resources/app.asar/cli.js', 'analyze', '/x.dem']}, 'demo analysis running (csdm analyze)'),
            ({'comm': 'python3', 'argv': ['python3', '/snap/google-cloud-cli/1/lib/gcloud.py', 'storage', 'cp', 'a', 'gs://b/c']}, 'demo transfer running (gcloud storage cp)'),
            ({'comm': 'python3', 'argv': ['sudo', 'python3', '/tmp/stage/install-sdr.py']}, 'maintenance script running (install-sdr.py)'),
            ({'comm': 'bash', 'argv': ['bash', '/tmp/analyzer-maintenance.sh', 'install', '/tmp/w.py']}, 'maintenance script running (analyzer-maintenance.sh)'),
        ]
        for process, expected in cases:
            with self.subTest(expected=expected):
                hard, _ = reasons(obs(extra_processes=[{'pid': 99, **process}]))
                self.assertEqual(hard, [expected])

    def test_long_running_helpers_are_not_activity(self):
        # The status reporter, the analysis worker loop, the unattended-upgrades shutdown helper,
        # the website's database tunnel and a gcloud listing never hold the VM.
        others = [{'pid': 98, 'comm': 'python3', 'argv': ['python3', '/snap/google-cloud-cli/1/lib/gcloud.py', 'storage', 'ls']},
                  {'pid': 97, 'comm': 'sshd', 'argv': ['sshd: onur [priv]']}]
        self.assertEqual(reasons(obs(extra_processes=others)), ([], []))

    def test_apt_daily_units_are_activity(self):
        hard, _ = reasons(obs(unit_states={'apt-daily-upgrade.service': ('activating', 'start')}))
        self.assertEqual(hard, ['apt-daily-upgrade.service running'])

    def test_ssh_terminal_counts_until_it_has_been_left_alone(self):
        hard, _ = reasons(obs(ssh=[{'user': 'onur', 'tty': 'pts/0', 'idle': 30}]))
        self.assertEqual(hard, ['ssh session onur@pts/0'])
        hard, soft, notes, _ = idle.classify(obs(ssh=[{'user': 'onur', 'tty': 'pts/0', 'idle': 61 * 60}]), CONFIG)
        self.assertEqual((hard, soft), ([], []))
        self.assertIn('ssh session onur@pts/0 ignored after 61 min without input', notes)

    def test_analysis_download_is_activity_while_growing(self):
        self.assertEqual(reasons(obs(downloads=[5]))[0], ['analysis download in progress'])
        self.assertEqual(reasons(obs(downloads=[3600])), ([], []))

    def test_uploads_mirror_the_website_stop_guard(self):
        _, soft = reasons(obs(uploads={'pending': 2, 'updatedAt': WALL - 10}))
        self.assertEqual(soft, ['2 demo upload(s) pending'])
        _, soft = reasons(obs(uploads={'pending': 0, 'updatedAt': WALL - 400}))
        self.assertEqual(soft, ['upload status 400 s old (upload in flight)'])
        _, soft = reasons(obs(uploads=None))
        self.assertEqual(soft, ['upload status unreadable'])
        _, soft = reasons(obs(uploads={'pending': 'x', 'updatedAt': None}))
        self.assertTrue(soft[0].startswith('upload status '))

    def test_stopped_uploader_does_not_hold(self):
        hard, soft, notes, _ = idle.classify(
            obs(unit_states={'csbatagi-demos.service': ('failed', 'failed')}, uploads={'pending': 3, 'updatedAt': 0}), CONFIG)
        self.assertEqual((hard, soft), ([], []))
        self.assertIn('uploader failed; 3 demo(s) wait on disk', notes)


class DecideTests(unittest.TestCase):
    def tick(self, state, now, hard=(), soft=(), boot=BOOT, config=CONFIG):
        return idle.decide(state, boot, list(hard), list(soft), now, config)

    def test_poweroff_after_fifteen_continuous_idle_minutes(self):
        state, actions = {}, []
        for minute in range(17):
            state, action, seconds, _ = self.tick(state, 100 + minute * 60.4)
            actions.append(action)
        self.assertEqual(actions[:15], ['idle'] * 15)
        self.assertEqual(actions[15], 'poweroff')

    def test_activity_resets_the_idle_clock(self):
        state = {}
        for minute in range(14):
            state, action, _, _ = self.tick(state, minute * 60)
        state, action, seconds, _ = self.tick(state, 14 * 60, hard=['1 player on the server'])
        self.assertEqual((action, seconds, state['idleSince']), ('active', 0.0, None))
        for minute in range(15, 30):
            state, action, _, _ = self.tick(state, minute * 60)
            self.assertEqual(action, 'idle')
        state, action, seconds, _ = self.tick(state, 30 * 60)
        self.assertEqual((action, seconds), ('poweroff', 900))

    def test_hold_pauses_until_the_cap_then_counts_as_idle(self):
        state = {}
        for minute in range(120):
            state, action, _, hold = self.tick(state, minute * 60, soft=['cs2 status unreadable'])
            self.assertEqual(action, 'held', minute)
        actions = []
        for minute in range(120, 136):
            state, action, _, _ = self.tick(state, minute * 60, soft=['cs2 status unreadable'])
            actions.append(action)
        self.assertEqual(actions, ['idle'] * 15 + ['poweroff'])

    def test_flapping_status_cannot_hold_forever(self):
        state, actions = {}, []
        for minute in range(200):
            soft = ['cs2 status unreadable'] if minute % 2 == 0 else []
            state, action, _, _ = self.tick(state, minute * 60, soft=soft)
            actions.append(action)
            if action == 'poweroff':
                break
        self.assertEqual(actions[-1], 'poweroff')
        # Held from minute 0; the cap ends at minute 120 while minute 119 was already idle.
        self.assertEqual(len(actions), 135)

    def test_activity_restarts_the_hold_cap(self):
        state = {}
        for minute in range(110):
            state, *_ = self.tick(state, minute * 60, soft=['1 demo upload(s) pending'])
        state, action, _, _ = self.tick(state, 110 * 60, hard=['2 players on the server'])
        self.assertIsNone(state['holdSince'])
        state, action, _, hold = self.tick(state, 111 * 60, soft=['1 demo upload(s) pending'])
        self.assertEqual((action, hold), ('held', 0.0))

    def test_new_boot_starts_from_zero(self):
        state = {}
        for minute in range(14):
            state, *_ = self.tick(state, minute * 60)
        state, action, seconds, _ = self.tick(state, 20, boot='boot-b')
        self.assertEqual((action, seconds, state['bootId']), ('idle', 0.0, 'boot-b'))

    def test_gaps_between_checks_restart_the_count(self):
        state = {}
        for minute in range(10):
            state, *_ = self.tick(state, minute * 60)
        state, action, seconds, _ = self.tick(state, 9 * 60 + 301)  # the timer was stopped for a while
        self.assertEqual((action, seconds), ('idle', 0.0))
        state, action, seconds, _ = self.tick(state, 10)  # clock went backwards
        self.assertEqual((action, seconds), ('idle', 0.0))

    def test_threshold_is_configurable(self):
        config = idle.load_config({'IDLE_SHUTDOWN_MINUTES': '5'})
        state = {}
        for minute in range(5):
            state, action, _, _ = self.tick(state, minute * 60, config=config)
            self.assertEqual(action, 'idle')
        self.assertEqual(self.tick(state, 300, config=config)[1], 'poweroff')


class ConfigTests(unittest.TestCase):
    def test_defaults_and_overrides(self):
        self.assertEqual((CONFIG['idle'], CONFIG['hold_cap'], CONFIG['ssh_idle'], CONFIG['dry_run']), (900, 7200, 3600, False))
        config = idle.load_config({'IDLE_SHUTDOWN_MINUTES': '30', 'IDLE_SHUTDOWN_HOLD_CAP_MINUTES': '240',
                                   'IDLE_SHUTDOWN_SSH_IDLE_MINUTES': '90', 'IDLE_SHUTDOWN_DRY_RUN': 'yes'})
        self.assertEqual((config['idle'], config['hold_cap'], config['ssh_idle'], config['dry_run']), (1800, 14400, 5400, True))

    def test_invalid_values_fall_back_to_defaults(self):
        for raw in ['0', '-5', 'abc', 'nan', '99999']:
            with self.subTest(raw=raw):
                config = idle.load_config({'IDLE_SHUTDOWN_MINUTES': raw})
                self.assertEqual(config['idle'], 900)
                self.assertEqual(len(config['warnings']), 1)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temp.name)
        self.state_file = root / 'run/csbatagi-idle/state.json'
        self.flag = root / 'etc/idle-shutdown.disabled'
        self.lines = []
        self.poweroffs = 0

    def tearDown(self):
        self.temp.cleanup()

    def poweroff(self):
        self.poweroffs += 1
        return subprocess.CompletedProcess(['systemctl', 'poweroff'], 0, '', '')

    def run_tick(self, now, observation=None, config=CONFIG, check=False):
        return idle.run(config, check=check, now=now, wall=WALL, observe_fn=lambda wall: observation or obs(),
                        state_file=self.state_file, disable_flag=self.flag, poweroff_fn=self.poweroff,
                        log_fn=self.lines.append)

    def test_sixteen_idle_ticks_power_off_exactly_once(self):
        actions = [self.run_tick(100 + minute * 60) for minute in range(16)]
        self.assertEqual(actions, ['idle'] * 15 + ['poweroff'])
        self.assertEqual(self.poweroffs, 1)
        self.assertEqual(self.lines[0], 'idle 0/15 min; cs2 active, 0 players, 0 bots (rcon)')
        self.assertTrue(self.lines[-1].startswith('POWERING OFF the game VM: idle 15/15 min: no players or activity for 15 minutes'))
        self.assertEqual(json.loads(self.state_file.read_text())['bootId'], BOOT)

    def test_players_keep_it_on_and_are_logged(self):
        for minute in range(30):
            self.assertEqual(self.run_tick(minute * 60, obs(game_fields={'humans': 4, 'live': True})), 'active')
        self.assertEqual(self.poweroffs, 0)
        self.assertEqual(self.lines[-1], 'active: 4 players on the server (idle clock reset); match live; cs2 active, 4 players, 0 bots (rcon)')

    def test_state_from_an_earlier_boot_is_ignored(self):
        self.state_file.parent.mkdir(parents=True)
        self.state_file.write_text(json.dumps({'bootId': 'old', 'lastCheck': 50, 'idleSince': 0, 'holdSince': None}))
        self.assertEqual(self.run_tick(60), 'idle')
        self.assertEqual(self.lines[-1], 'idle 0/15 min; cs2 active, 0 players, 0 bots (rcon)')

    def test_disable_flag_clears_the_clock_and_never_powers_off(self):
        for minute in range(10):
            self.run_tick(minute * 60)
        self.flag.parent.mkdir(parents=True)
        self.flag.write_text('')
        for minute in range(10, 40):
            self.assertEqual(self.run_tick(minute * 60), 'disabled')
        self.assertFalse(self.state_file.exists())
        self.flag.unlink()
        self.assertEqual(self.run_tick(40 * 60), 'idle')
        self.assertTrue(self.lines[-1].startswith('idle 0/15 min'))
        self.assertEqual(self.poweroffs, 0)

    def test_dry_run_only_logs(self):
        config = idle.load_config({'IDLE_SHUTDOWN_DRY_RUN': '1'})
        actions = [self.run_tick(minute * 60, config=config) for minute in range(20)]
        self.assertEqual(actions[15:], ['dry-run'] * 5)
        self.assertEqual(self.poweroffs, 0)
        self.assertIn('not powering off', self.lines[-1])

    def test_check_mode_changes_nothing(self):
        for minute in range(15):
            self.run_tick(minute * 60)
        before = self.state_file.read_text()
        self.assertEqual(self.run_tick(15 * 60, check=True), 'poweroff')
        self.assertEqual((self.state_file.read_text(), self.poweroffs), (before, 0))
        self.assertTrue(self.lines[-1].startswith('would power off now: idle 15/15 min'))

    def test_failed_poweroff_is_logged_and_retried(self):
        results = iter([subprocess.CompletedProcess([], 1, '', 'Operation inhibited'),
                        subprocess.CompletedProcess([], 0, '', '')])
        self.poweroff = lambda: next(results)
        actions = [self.run_tick(minute * 60) for minute in range(17)]
        self.assertEqual(actions[15:], ['poweroff-failed', 'poweroff'])
        self.assertIn('poweroff failed (exit 1): Operation inhibited; retrying next run', self.lines)

    def test_held_line_names_the_reason(self):
        self.run_tick(0, obs(game=None, gameSource='rcon TimeoutError, status file missing or stale'))
        self.assertEqual(self.lines[-1], 'held 0/120 min, not counted as idle: cs2 status unreadable '
                                         '(rcon TimeoutError, status file missing or stale)')


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_processes_read_proc(self):
        proc = self.root / 'proc'
        for pid, comm, cmdline in [('1', 'systemd', b'/sbin/init\0splash\0'), ('2', 'kthreadd', b''),
                                   ('77', 'sshd', b'sshd: onur@pts/0' + b' ' * 20 + b'\0\0')]:
            (proc / pid).mkdir(parents=True)
            (proc / pid / 'comm').write_text(comm + '\n')
            (proc / pid / 'cmdline').write_bytes(cmdline)
        (proc / 'self').mkdir()
        found = {p['pid']: p for p in idle.processes(proc)}
        self.assertEqual(sorted(found), [1, 2, 77])
        self.assertEqual(found[1]['argv'], ['/sbin/init', 'splash'])
        self.assertEqual(found[2]['argv'], [])

    def test_ssh_sessions_use_terminal_input_time(self):
        dev = self.root / 'dev'
        (dev / 'pts').mkdir(parents=True)
        (dev / 'pts/0').write_text('')
        (dev / 'pts/3').write_text('')
        os.utime(dev / 'pts/0', (WALL - 120, WALL))
        os.utime(dev / 'pts/3', (WALL - 7200, WALL))
        procs = [{'pid': 1, 'comm': 'sshd', 'argv': ['sshd: onur@pts/0' + ' ' * 10]},
                 {'pid': 2, 'comm': 'sshd', 'argv': ['sshd: onur [priv]']},
                 {'pid': 3, 'comm': 'sshd-session', 'argv': ['sshd-session: admin@pts/3']},
                 {'pid': 4, 'comm': 'sshd', 'argv': ['sshd: csbatagi@notty']},
                 {'pid': 5, 'comm': 'sshd', 'argv': ['sshd: gone@pts/9']},
                 {'pid': 6, 'comm': 'bash', 'argv': ['bash', '-c', 'echo sshd: onur@pts/0']}]
        sessions = idle.ssh_sessions(procs, WALL, dev)
        self.assertEqual(sessions, [{'user': 'onur', 'tty': 'pts/0', 'idle': 120.0},
                                    {'user': 'admin', 'tty': 'pts/3', 'idle': 7200.0}])

    def test_unit_states_parse_systemctl_show(self):
        output = ('Id=cs2.service\nActiveState=activating\nSubState=start-pre\n\n'
                  'Id=csbatagi-demos.service\nActiveState=active\nSubState=running\n\n'
                  'Id=apt-daily.service\nActiveState=inactive\nSubState=dead\n')
        with mock.patch.object(idle.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, output, '')) as run:
            states = idle.unit_states()
        self.assertEqual(states, {'cs2.service': ('activating', 'start-pre'),
                                  'csbatagi-demos.service': ('active', 'running'),
                                  'apt-daily.service': ('inactive', 'dead')})
        self.assertIn('--property=Id,ActiveState,SubState', run.call_args.args[0])

    def test_game_status_from_rcon_then_fresh_file(self):
        helper = self.root / 'rcon-local.py'
        helper.write_text('def command(text):\n    assert text == "csbatagi_status"\n'
                          '    return \'noise {"humans": 2, "live": true} tail\'\n')
        status_file = self.root / 'status.json'
        self.assertEqual(idle.game_status(WALL, helper, status_file), ({'humans': 2, 'live': True}, 'rcon'))

        helper.write_text('def command(text):\n    raise ConnectionRefusedError()\n')
        status_file.write_text(json.dumps({'humans': 0, 'recording': True}))
        os.utime(status_file, (WALL - 30, WALL - 30))
        self.assertEqual(idle.game_status(WALL, helper, status_file), ({'humans': 0, 'recording': True}, 'status file'))

        os.utime(status_file, (WALL - 600, WALL - 600))
        self.assertEqual(idle.game_status(WALL, helper, status_file),
                         (None, 'rcon ConnectionRefusedError, status file missing or stale'))

        helper.write_text('def command(text):\n    return "Unknown command csbatagi_status"\n')
        self.assertEqual(idle.game_status(WALL, helper, self.root / 'missing.json'),
                         (None, 'rcon ValueError, status file missing or stale'))

    def test_download_ages(self):
        folder = self.root / 'analysis-downloads'
        folder.mkdir()
        (folder / 'a.dem.part').write_text('x')
        (folder / 'b.dem').write_text('x')
        os.utime(folder / 'a.dem.part', (WALL - 20, WALL - 20))
        self.assertEqual(idle.download_ages(WALL, folder), [20.0])
        self.assertEqual(idle.download_ages(WALL, self.root / 'missing'), [])

    def test_read_json_rejects_non_objects(self):
        path = self.root / 'x.json'
        path.write_text('[1, 2]')
        self.assertIsNone(idle.read_json(path))
        path.write_text('{"pending": 1}')
        self.assertEqual(idle.read_json(path), {'pending': 1})


if __name__ == '__main__':
    unittest.main()
