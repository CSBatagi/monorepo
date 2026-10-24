#!/usr/bin/env python3
"""Install (or with --remove, uninstall) the idle shutdown timer on the game VM. Run as root.

Idempotent: unchanged files are left alone, changed ones are backed up first. Installing does
not touch cs2 or the demo services, so it is safe while people play; the first check only
starts the idle clock. Stage the files with Unix line endings (git -c core.autocrlf=false archive).
"""
import datetime
import filecmp
import json
import os
import pathlib
import py_compile
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
TARGET = pathlib.Path('/usr/local/lib/csbatagi')
UNITS = pathlib.Path('/etc/systemd/system')
CONFIG_DIR = pathlib.Path('/etc/csbatagi')
CONFIG = CONFIG_DIR / 'idle-shutdown.env'
BACKUPS = pathlib.Path('/home/steam/csbatagi-backups')
TIMER = 'csbatagi-idle-shutdown.timer'
SERVICE = 'csbatagi-idle-shutdown.service'
FILES = [('idle-shutdown.py', TARGET, 0o755), (SERVICE, UNITS, 0o644), (TIMER, UNITS, 0o644)]
CONFIG_TEMPLATE = """\
# CS Batagi idle shutdown (csbatagi-idle-shutdown.timer). Uncomment a line to override it;
# the next check (within a minute) uses the new value. Runbook: docs/operations/cs2-idle-shutdown.md
#
# Minutes without players or other activity before the VM powers itself off.
#IDLE_SHUTDOWN_MINUTES=15
# Longest time an unreadable CS2 status, pending demo uploads or a match with nobody connected
# may keep an otherwise idle VM up.
#IDLE_SHUTDOWN_HOLD_CAP_MINUTES=120
# An SSH terminal stops counting as activity after this many minutes without keyboard input.
#IDLE_SHUTDOWN_SSH_IDLE_MINUTES=60
# 1 = only log that it would power off.
#IDLE_SHUTDOWN_DRY_RUN=0
#
# Switch it off: touch /etc/csbatagi/idle-shutdown.disabled   (on again: delete that file)
"""


def run(*args, check=True):
    return subprocess.run(args, check=check, text=True, capture_output=True)


def systemctl(*args):
    result = run('systemctl', *args, check=False)
    if result.returncode != 0:
        raise RuntimeError(f'systemctl {" ".join(args)} failed: {result.stderr.strip()}')
    return result.stdout.strip()


def install():
    for name, _, _ in FILES:
        source = HERE / name
        if not source.is_file():
            raise RuntimeError(f'{name} is missing next to the installer')
        if b'\r' in source.read_bytes():
            raise RuntimeError(f'{name} has Windows line endings; stage with git -c core.autocrlf=false archive')
    py_compile.compile(str(HERE / 'idle-shutdown.py'), doraise=True)
    if not (TARGET / 'rcon-local.py').is_file():
        raise RuntimeError(f'{TARGET}/rcon-local.py missing: this is not the managed CS2 VM')

    changed = [(name, folder / name, mode) for name, folder, mode in FILES
               if not (folder / name).exists() or not filecmp.cmp(HERE / name, folder / name, shallow=False)]
    if changed:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = BACKUPS / ('idle-shutdown-' + stamp)
        backup.mkdir(mode=0o700, parents=True)
        manifest = []
        for name, destination, _ in changed:
            manifest.append({'path': str(destination), 'existed': destination.exists()})
            if destination.exists():
                shutil.copy2(destination, backup / name)
        (backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        for name, destination, mode in changed:
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.new')
            shutil.copy2(HERE / name, temporary)
            temporary.chmod(mode)
            shutil.chown(temporary, user='root', group='root')
            temporary.replace(destination)
        print('Installed:', ', '.join(name for name, _, _ in changed), '- backup', backup)
    else:
        print('Files already current.')

    CONFIG_DIR.mkdir(mode=0o755, exist_ok=True)
    if not CONFIG.exists():
        CONFIG.write_text(CONFIG_TEMPLATE)
        CONFIG.chmod(0o644)
        print('Wrote default settings', CONFIG)
    else:
        print('Kept existing settings', CONFIG)

    systemctl('daemon-reload')
    systemctl('enable', '--now', TIMER)
    if any(name == TIMER for name, _, _ in changed):
        systemctl('restart', TIMER)
    print('Timer', systemctl('is-enabled', TIMER), '/', systemctl('is-active', TIMER))
    check = run('/usr/bin/python3', str(TARGET / 'idle-shutdown.py'), '--check', check=False)
    print('Current check:', (check.stdout + check.stderr).strip())
    print(f'Logs: journalctl -u {SERVICE} -f. Disable: touch {CONFIG_DIR}/idle-shutdown.disabled.')


def remove():
    run('systemctl', 'disable', '--now', TIMER, check=False)
    run('systemctl', 'stop', SERVICE, check=False)
    for name, folder, _ in FILES:
        (folder / name).unlink(missing_ok=True)
    shutil.rmtree('/run/csbatagi-idle', ignore_errors=True)
    systemctl('daemon-reload')
    print(f'Removed the idle shutdown timer; kept {CONFIG} and backups.')


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Run as root.')
    if sys.argv[1:] not in [[], ['--remove']]:
        raise SystemExit('usage: install-idle-shutdown.py [--remove]')
    try:
        remove() if sys.argv[1:] == ['--remove'] else install()
    except (OSError, RuntimeError, py_compile.PyCompileError) as error:
        raise SystemExit(f'Idle shutdown installation stopped: {error}') from None
