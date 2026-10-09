#!/usr/bin/env python3
"""Install only the SDR integration on an empty managed server. Run as root."""
import datetime
import importlib.util
import json
import os
import pathlib
import py_compile
import shutil
import subprocess
import time

HERE = pathlib.Path(__file__).resolve().parent
TARGET = pathlib.Path('/usr/local/lib/csbatagi')
ROOT = pathlib.Path('/home/steam/csbatagi-updates')
GAME = pathlib.Path('/home/steam/cs2/game/csgo')
FILES = ['sdr.py', 'connection-gate.py', 'gate.sh', 'launch.py', 'rcon-local.py', 'update-stack.py']


def module(name, folder):
    spec = importlib.util.spec_from_file_location(name, folder / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def occupied():
    if subprocess.run(['pgrep', '-f', '[c]li.js analyze'], stdout=subprocess.DEVNULL).returncode == 0:
        raise RuntimeError('demo_analysis_running')
    if subprocess.run(['pgrep', '-x', 'steamcmd'], stdout=subprocess.DEVNULL).returncode == 0:
        raise RuntimeError('game_update_running')
    state = run('systemctl', 'show', 'cs2', '--property=ActiveState', '--value', capture_output=True).stdout.strip()
    if state in ['activating', 'deactivating']:
        raise RuntimeError('game_transition_running')
    if subprocess.run(['pgrep', '-x', 'cs2'], stdout=subprocess.DEVNULL).returncode == 0:
        status = json.loads(module('rcon-local', TARGET).command('csbatagi_status'))
        if any(status.get(k) for k in ['humans', 'matchLoaded', 'live', 'preparing', 'recording', 'demoFailed']):
            raise RuntimeError('game_occupied')
        uploads = status.get('uploads', {})
        if uploads.get('pending') != 0 or time.time() - uploads.get('updatedAt', 0) > 120:
            raise RuntimeError('uploads_unverified')
    elif (GAME / 'csbatagi-state/uploads.json').exists():
        if json.loads((GAME / 'csbatagi-state/uploads.json').read_text()).get('pending') != 0:
            raise RuntimeError('uploads_pending')


def install():
    if os.geteuid() != 0:
        raise RuntimeError('root_required')
    for name in FILES + ['cs2.service']:
        if not (HERE / name).is_file():
            raise RuntimeError('source_missing')
        if name.endswith('.py'):
            py_compile.compile(str(HERE / name), doraise=True)
    if not (TARGET / 'verify-start.sh').exists() or not ROOT.is_dir():
        raise RuntimeError('managed_updater_required')
    sdr = module('sdr', HERE)
    gameinfo = GAME / 'gameinfo_branchspecific.gi'
    sdr.configured(gameinfo.read_text(), True)  # Validate Valve layout before mutation.
    occupied()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = pathlib.Path('/home/steam/csbatagi-backups') / ('sdr-' + stamp)
    backup.mkdir(mode=0o700, parents=True)
    destinations = [(HERE / name, TARGET / name) for name in FILES]
    destinations.append((HERE / 'cs2.service', pathlib.Path('/etc/systemd/system/cs2.service')))
    originals = [target for _, target in destinations] + [gameinfo, GAME / 'cfg/server.cfg', ROOT / 'sdr-enabled']
    manifest = []
    for index, target in enumerate(originals):
        saved = str(index) + '-' + target.name
        manifest.append({'path': str(target), 'existed': target.exists(), 'backup': saved})
        if target.exists():
            shutil.copy2(target, backup / saved)
    (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    # Backups exclude credentials, demos, custom patches and their installed DLLs.
    occupied()
    run(str(TARGET / 'gate.sh'), 'close')
    run('systemctl', 'stop', 'cs2')
    for source, target in destinations:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        target.chmod(0o755 if target.suffix in ['.py', '.sh'] else 0o644)
        shutil.chown(target, user='root', group='root')
    config = GAME / 'cfg/server.cfg'
    config.write_text(sdr.gate_config(config.read_text()))
    flag = ROOT / 'sdr-enabled'
    flag.write_text('1\n')
    flag.chmod(0o644)
    shutil.chown(flag, user='root', group='root')
    run(str(TARGET / 'gate.sh'), 'close')
    run('systemctl', 'daemon-reload')
    run('systemctl', 'restart', 'csbatagi-update-status')
    run('systemctl', 'reset-failed', 'cs2')
    run('systemctl', 'start', '--no-block', 'cs2')
    print('SDR integration installed; startup verification is pending. Backup:', backup)


if __name__ == '__main__':
    try:
        install()
    except Exception:
        raise SystemExit('SDR installation stopped; inspect the service and sanitized updater state before retrying.') from None
