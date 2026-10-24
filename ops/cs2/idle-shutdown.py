#!/usr/bin/env python3
"""Power the game VM off once nothing has needed it for 15 minutes in a row.

Runs as root from csbatagi-idle-shutdown.timer once a minute. Each run reads the signals
below, keeps a small state file under /run (tmpfs, so every boot starts from zero) and logs
one line to the journal. After IDLE_SHUTDOWN_MINUTES of continuous idle observations it runs
`systemctl poweroff`: Compute Engine then moves the instance to TERMINATED, as the website's
"Server Kapat" does, and the website's start button works the same afterwards.

Activity (resets the idle clock):
  - human players on CS2 (bots and CSTV do not count), or a newly loaded website match;
  - cs2.service starting or stopping (SteamCMD and plugin updates, startup verification),
    update-stack prepare/verify/rollback, steamcmd, dotnet builds, or an in-progress stage of
    this boot in csbatagi-updates/status.json;
  - demo analysis (the CS Demo Manager CLI, an analysis download) and archive transfers;
  - apt, dpkg or unattended-upgrade, the apt-daily units, ops installers;
  - an SSH terminal (a pty session) with keyboard input within IDLE_SHUTDOWN_SSH_IDLE_MINUTES.
    Sessions without a terminal (the website's database tunnel, scripted commands) do not count.
Holds (not idle, but for at most IDLE_SHUTDOWN_HOLD_CAP_MINUTES without any activity above):
  - CS2 runs but its status cannot be read over RCON or from the plugin's status file;
  - a match is live, preparing, started or recording, or a demo failed, with nobody connected;
  - demo uploads are pending, or the running uploader's status is stale (an upload in flight).
A stopped or failed cs2.service is not activity: nobody can play on it.

`--check` prints what the next run would see and decide, without changing anything.
"""
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys
import time

GAME = pathlib.Path('/home/steam/cs2/game/csgo')
GAME_STATE = GAME / 'csbatagi-state'
UPDATE_STATUS = pathlib.Path('/home/steam/csbatagi-updates/status.json')
RCON_HELPER = pathlib.Path('/usr/local/lib/csbatagi/rcon-local.py')
STATE_FILE = pathlib.Path('/run/csbatagi-idle/state.json')
DISABLE_FLAG = pathlib.Path('/etc/csbatagi/idle-shutdown.disabled')
BOOT_ID = pathlib.Path('/proc/sys/kernel/random/boot_id')
PROC = pathlib.Path('/proc')
DEV = pathlib.Path('/dev')

UNITS = ['cs2.service', 'csbatagi-demos.service', 'apt-daily.service', 'apt-daily-upgrade.service']
TRANSITIONS = {'activating', 'deactivating', 'reloading'}
UPDATE_STAGES = {'checking', 'updating_game', 'updating_plugins', 'verifying'}
MATCH_FLAGS = ['live', 'preparing', 'recording', 'matchStarted', 'demoFailed']
STATUS_FRESH = 120    # seconds; the plugin rewrites status.json every 5 s, the uploader uploads.json every 30 s
UPDATE_FRESH = 3600   # cs2.service allows startup (updates and verification) an hour
DOWNLOAD_FRESH = 120  # an analysis download writes its .part file continuously
MAX_GAP = 300         # observations further apart than this do not add up to continuous time
PACKAGE_TOOLS = {'apt', 'apt-get', 'aptitude', 'dpkg'}
SSH_TITLE = re.compile(r'^sshd(?:-session)?: (\S+?)@((?:pts/|tty)\d+)(?:\s|$)')
MAINTENANCE = re.compile(r'^(?:install-[\w.-]+\.(?:py|sh)|analyzer-maintenance\.sh)$')


def log(message):
    print(message, flush=True)


def load_config(environ):
    """Minutes from the environment (EnvironmentFile); invalid values fall back to the defaults."""
    warnings = []

    def minutes(name, default):
        raw = environ.get(name, '').strip()
        if not raw:
            return float(default)
        try:
            value = float(raw)
        except ValueError:
            value = 0
        if not 1 <= value <= 24 * 60:
            warnings.append(f'{name}={raw!r} ignored, using {default}')
            return float(default)
        return value

    return {
        'idle': minutes('IDLE_SHUTDOWN_MINUTES', 15) * 60,
        'hold_cap': minutes('IDLE_SHUTDOWN_HOLD_CAP_MINUTES', 120) * 60,
        'ssh_idle': minutes('IDLE_SHUTDOWN_SSH_IDLE_MINUTES', 60) * 60,
        'dry_run': environ.get('IDLE_SHUTDOWN_DRY_RUN', '').strip().lower() in {'1', 'true', 'yes', 'on'},
        'warnings': warnings,
    }


def clock():
    """Seconds since boot, unaffected by wall-clock jumps; the state file never outlives a boot."""
    if hasattr(time, 'CLOCK_BOOTTIME'):
        return time.clock_gettime(time.CLOCK_BOOTTIME)
    return time.monotonic()


# ---------------------------------------------------------------------------------------------
# Observation: read-only probes of the VM. Each one fails towards "not idle" where it matters.

def unit_states(units=UNITS):
    result = subprocess.run(['systemctl', 'show', '--no-pager', '--property=Id,ActiveState,SubState', *units],
                            capture_output=True, text=True, timeout=20)
    states = {}
    for block in result.stdout.strip().split('\n\n'):
        fields = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
        if fields.get('Id'):
            states[fields['Id']] = (fields.get('ActiveState', ''), fields.get('SubState', ''))
    return states


def processes(proc=PROC):
    own = os.getpid()
    found = []
    for entry in proc.iterdir():
        if not entry.name.isdigit() or int(entry.name) == own:
            continue
        try:
            raw = (entry / 'cmdline').read_bytes()
            comm = (entry / 'comm').read_text().strip()
        except OSError:
            continue  # exited while we looked
        argv = [part.decode(errors='replace') for part in raw.split(b'\0') if part]
        found.append({'pid': int(entry.name), 'comm': comm, 'argv': argv})
    return found


def ssh_sessions(procs, wall, dev=DEV):
    """Interactive SSH logins: sshd titles its session process "sshd: user@pts/N".

    The terminal's access time moves when the shell reads keyboard input, as for `w` and `who -u`.
    A session without a terminal ("user@notty", e.g. the website's database tunnel) is skipped.
    """
    sessions = {}
    for process in procs:
        match = SSH_TITLE.match(' '.join(process['argv']).strip())
        if not match:
            continue
        user, tty = match.groups()
        try:
            last_input = (dev / tty).stat().st_atime
        except OSError:
            continue  # the terminal is gone: the session is closing
        sessions[tty] = {'user': user, 'tty': tty, 'idle': max(0.0, wall - last_input)}
    return sorted(sessions.values(), key=lambda session: session['tty'])


def parse_status(text):
    start, end = text.find('{'), text.rfind('}')
    if start < 0 or end < start:
        raise ValueError('no status JSON')
    status = json.loads(text[start:end + 1])
    if not isinstance(status, dict):
        raise ValueError('status is not an object')
    return status


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def game_status(wall, rcon_helper=RCON_HELPER, status_file=GAME_STATE / 'status.json'):
    """The plugin's csbatagi_status: RCON as the backend reads it, else its status file if fresh."""
    try:
        return parse_status(load_module(rcon_helper, 'rcon_local').command('csbatagi_status')), 'rcon'
    except Exception as error:  # noqa: BLE001 - any RCON failure falls back to the file
        failure = type(error).__name__
    try:
        if wall - status_file.stat().st_mtime <= STATUS_FRESH:
            return parse_status(status_file.read_text()), 'status file'
    except (OSError, ValueError):
        pass
    return None, f'rcon {failure}, status file missing or stale'


def read_json(path):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def download_ages(wall, folder=GAME_STATE / 'analysis-downloads'):
    try:
        return [wall - part.stat().st_mtime for part in folder.glob('*.part')]
    except OSError:
        return []


def boot_id(path=BOOT_ID):
    return path.read_text().strip()


def observe(wall):
    try:
        units = unit_states()
    except (OSError, subprocess.SubprocessError):
        units = {}
    procs = processes()
    cs2_unit = units.get('cs2.service', ('', ''))[0]
    cs2_process = any(process['comm'] == 'cs2' for process in procs)
    observation = {
        'wall': wall, 'bootId': boot_id(), 'units': units, 'processes': procs, 'cs2Process': cs2_process,
        'game': None, 'gameSource': None, 'uploads': read_json(GAME_STATE / 'uploads.json'),
        'update': read_json(UPDATE_STATUS), 'ssh': ssh_sessions(procs, wall), 'downloads': download_ages(wall),
    }
    if cs2_unit not in TRANSITIONS and (cs2_unit == 'active' or cs2_process):
        observation['game'], observation['gameSource'] = game_status(wall)
    return observation


# ---------------------------------------------------------------------------------------------
# Classification: pure, so the tests can cover every signal without a VM.

def basename(arg):
    return arg.rstrip('/').rsplit('/', 1)[-1]


def number(value, default=0.0):
    """Numbers from JSON written by other programs; anything malformed reads as the default."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if abs(result) < 1e15 else default  # also rejects NaN and infinity


def process_activity(procs):
    found = []
    for process in procs:
        argv, comm = process['argv'], process['comm']
        names = [basename(arg) for arg in argv]
        program = names[0] if names else ''
        if comm == 'steamcmd' or program.startswith('steamcmd'):
            found.append('steamcmd running')
        elif comm == 'dotnet':
            found.append('plugin build (dotnet) running')
        elif 'update-stack.py' in names and any(arg in argv for arg in ['prepare', 'verify', 'rollback']):
            found.append('update-stack ' + next(arg for arg in argv if arg in ['prepare', 'verify', 'rollback']))
        elif program in PACKAGE_TOOLS or 'unattended-upgrade' in names:
            found.append(f'package manager running ({program if program in PACKAGE_TOOLS else "unattended-upgrade"})')
        elif 'analyze' in argv and any(name == 'cli.js' or name == 'csdm' for name in names):
            found.append('demo analysis running (csdm analyze)')
        elif any(name in ['gcloud', 'gcloud.py'] for name in names) and 'storage' in argv and 'cp' in argv:
            found.append('demo transfer running (gcloud storage cp)')
        elif any(MAINTENANCE.match(name) for name in names[:3]):
            found.append('maintenance script running (' + next(n for n in names[:3] if MAINTENANCE.match(n)) + ')')
    return sorted(set(found))


def classify(obs, config, last_match_id=None):
    """Sort what the VM is doing into activity (hard), holds (soft) and plain notes."""
    hard, soft, notes = [], [], []
    units = obs['units']
    wall = obs['wall']
    cs2_state, cs2_sub = units.get('cs2.service', ('', ''))
    match_id = last_match_id

    if not cs2_state:
        soft.append('cs2.service state unreadable')
    elif cs2_state == 'activating':
        hard.append(f'cs2 starting ({cs2_sub}: updates/verification)')
    elif cs2_state in TRANSITIONS:
        hard.append(f'cs2 {cs2_state}')
    elif cs2_state == 'active' or obs['cs2Process']:
        game = obs['game']
        if game is None:
            soft.append(f'cs2 status unreadable ({obs.get("gameSource") or "no answer"})')
        else:
            humans = int(number(game.get('humans')))
            flags = [flag for flag in MATCH_FLAGS if game.get(flag)]
            if humans > 0:
                hard.append(f'{humans} player{"s" if humans != 1 else ""} on the server')
            if flags:
                (notes if humans > 0 else soft).append('match ' + '/'.join(flags) + ('' if humans > 0 else ' with no players'))
            if game.get('matchLoaded'):
                match_id = game.get('matchId')
                if match_id != last_match_id:
                    hard.append(f'match {match_id} loaded')
            else:
                match_id = None
            notes.append(f'cs2 {cs2_state or "process"}, {humans} players, {int(number(game.get("bots")))} bots'
                         f' ({obs.get("gameSource") or "status"})')
    else:
        notes.append(f'cs2 {cs2_state}, not running')

    update = obs.get('update') or {}
    if (update.get('stage') in UPDATE_STAGES and update.get('bootId') == obs['bootId']
            and wall - number(update.get('updatedAt')) < UPDATE_FRESH):
        hard.append('game update stage ' + update['stage'])

    hard.extend(process_activity(obs['processes']))
    for unit in ['apt-daily.service', 'apt-daily-upgrade.service']:
        if units.get(unit, ('', ''))[0] in TRANSITIONS:
            hard.append(unit + ' running')

    for session in obs['ssh']:
        label = f'{session["user"]}@{session["tty"]}'
        if session['idle'] < config['ssh_idle']:
            hard.append(f'ssh session {label}')
        else:
            notes.append(f'ssh session {label} ignored after {int(session["idle"] // 60)} min without input')

    if any(age < DOWNLOAD_FRESH for age in obs['downloads']):
        hard.append('analysis download in progress')

    uploader = units.get('csbatagi-demos.service', ('', ''))[0]
    uploads = obs.get('uploads')
    pending = int(number((uploads or {}).get('pending')))
    if uploader in {'active', 'activating', 'reloading'}:
        age = wall - number((uploads or {}).get('updatedAt'))
        if uploads is None:
            soft.append('upload status unreadable')
        elif age > STATUS_FRESH:
            soft.append(f'upload status {int(age)} s old (upload in flight)')
        elif pending > 0:
            soft.append(f'{pending} demo upload(s) pending')
    elif pending > 0:
        notes.append(f'uploader {uploader or "unknown"}; {pending} demo(s) wait on disk')

    return sorted(set(hard)), sorted(set(soft)), notes, match_id


def decide(state, boot, hard, soft, now, config):
    """Advance the idle clock. Returns (new state, action, idle seconds, hold seconds).

    Idle time only accumulates across consecutive observations at most MAX_GAP apart, inside
    one boot. Activity resets both clocks. A hold pauses the idle clock, but only for
    hold_cap seconds counted from the first hold since the last activity, so a broken or
    flapping status reader cannot keep the VM up forever.
    """
    if state.get('bootId') != boot:
        state = {}
    last = state.get('lastCheck')
    continuous = last is not None and 0 <= now - last <= MAX_GAP
    idle_since = state.get('idleSince') if continuous else None
    hold_since = state.get('holdSince') if continuous else None
    held_out = False
    if hard:
        idle_since = hold_since = None
        action = 'active'
    else:
        if soft:
            hold_since = now if hold_since is None else hold_since
            if now - hold_since < config['hold_cap']:
                idle_since = None
                action = 'held'
            else:
                held_out = True
        if not soft or held_out:
            idle_since = now if idle_since is None else idle_since
            action = 'poweroff' if now - idle_since >= config['idle'] else 'idle'
    new_state = {**state, 'bootId': boot, 'lastCheck': now, 'idleSince': idle_since, 'holdSince': hold_since,
                 'lastAction': action}
    idle = now - idle_since if idle_since is not None else 0.0
    hold = now - hold_since if hold_since is not None else 0.0
    return new_state, action, idle, hold


def describe(action, idle, hold, hard, soft, notes, config):
    limit, cap = int(config['idle'] // 60), int(config['hold_cap'] // 60)
    context = ('; ' + '; '.join(notes)) if notes else ''
    if action == 'active':
        return 'active: ' + '; '.join(hard) + ' (idle clock reset)' + context
    if action == 'held':
        return f'held {int(hold // 60)}/{cap} min, not counted as idle: ' + '; '.join(soft) + context
    over = f'; hold cap of {cap} min reached, ignoring: ' + '; '.join(soft) if soft else ''
    if action == 'poweroff':
        return f'idle {int(idle // 60)}/{limit} min: no players or activity for {limit} minutes{over}{context}'
    return f'idle {int(idle // 60)}/{limit} min{over}{context}'


# ---------------------------------------------------------------------------------------------

def load_state(path):
    return read_json(path) or {}


def save_state(path, state):
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(state))
    temporary.replace(path)


def poweroff():
    return subprocess.run(['systemctl', 'poweroff'], capture_output=True, text=True, timeout=60)


def run(config, *, check=False, now=None, wall=None, observe_fn=observe, state_file=STATE_FILE,
        disable_flag=DISABLE_FLAG, poweroff_fn=poweroff, log_fn=log):
    """One timer tick. Returns the action taken."""
    now = clock() if now is None else now
    wall = time.time() if wall is None else wall
    for warning in config['warnings']:
        log_fn('config: ' + warning)
    if disable_flag.exists() and not check:
        if state_file.exists():
            state_file.unlink()
        log_fn(f'disabled by {disable_flag}; idle clock cleared')
        return 'disabled'
    obs = observe_fn(wall)
    state = load_state(state_file)
    if state.get('bootId') != obs['bootId']:
        state = {}
    hard, soft, notes, match_id = classify(obs, config, state.get('matchId'))
    new_state, action, idle, hold = decide(state, obs['bootId'], hard, soft, now, config)
    new_state['matchId'] = match_id
    message = describe(action, idle, hold, hard, soft, notes, config)
    if check:
        log_fn(('would power off now: ' if action == 'poweroff' else 'next run: ') + message)
        if disable_flag.exists():
            log_fn(f'disabled by {disable_flag}: the timer will not power off')
        return action
    if action == 'poweroff' and config['dry_run']:
        log_fn(message + ' - IDLE_SHUTDOWN_DRY_RUN is set, not powering off')
        save_state(state_file, new_state)
        return 'dry-run'
    save_state(state_file, new_state)
    if action != 'poweroff':
        log_fn(message)
        return action
    log_fn('POWERING OFF the game VM: ' + message)
    result = poweroff_fn()
    if result.returncode != 0:
        log_fn(f'poweroff failed (exit {result.returncode}): {(result.stderr or result.stdout).strip()[:300]}; retrying next run')
        return 'poweroff-failed'
    return 'poweroff'


def main(argv):
    if argv not in [[], ['--check']]:
        raise SystemExit('usage: idle-shutdown.py [--check]')
    run(load_config(os.environ), check=argv == ['--check'])


if __name__ == '__main__':
    main(sys.argv[1:])
