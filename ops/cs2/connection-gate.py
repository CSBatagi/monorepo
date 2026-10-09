#!/usr/bin/env python3
"""Root-managed password gate covers direct UDP and Steam relay admission."""
import importlib.util
import json
import os
import pathlib
import re
import secrets
import sys

GAME = pathlib.Path('/home/steam/cs2/game/csgo')
ROOT = pathlib.Path('/home/steam/csbatagi-updates')
HERE = pathlib.Path(__file__).resolve().parent
BOOT = pathlib.Path('/proc/sys/kernel/random/boot_id')
READY = pathlib.Path('/run/csbatagi/ready')


def local_module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def club_password(config):
    matches = re.findall(r'^\s*sv_password\s+"([^"\r\n]*)"\s*(?://[^\n]*)?$', config, re.M)
    if len(matches) != 1 or not matches[0] or any(c in matches[0] for c in '\\;'):
        raise RuntimeError('invalid_club_password')
    return matches[0]


def write_gate(password):
    import pwd
    target = GAME / 'cfg/csbatagi_startup_gate.cfg'
    partial = target.with_suffix('.tmp')
    with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        stream.write(f'sv_password "{password}"\n')
    steam = pwd.getpwnam('steam')
    os.chown(partial, steam.pw_uid, steam.pw_gid)
    partial.replace(target)


def close():
    READY.unlink(missing_ok=True)
    password = secrets.token_hex(32)
    write_gate(password)
    # Also lock a still-running instance during a controlled shutdown/failure.
    try:
        local_module('rcon-local').command(f'sv_password "{password}"')
    except (OSError, ValueError, ConnectionError):
        pass  # No RCON listener before launch; launch executes the gate config.


def open_gate():
    state = json.loads((ROOT / 'status.json').read_text())
    boot = BOOT.read_text().strip()
    if state.get('stage') != 'ready' or state.get('bootId') != boot:
        raise RuntimeError('startup_not_verified')
    command = local_module('rcon-local').command
    local_module('sdr').validate(command)
    password = club_password((GAME / 'cfg/csbatagi_secrets.cfg').read_text())
    command(f'sv_password "{password}"')  # Response is deliberately never printed.
    write_gate(password)  # Every map executes server.cfg; keep the verified password.
    READY.parent.mkdir(mode=0o755, exist_ok=True)
    partial = READY.with_suffix('.tmp')
    partial.write_text(boot)
    partial.chmod(0o644)
    partial.replace(READY)


if __name__ == '__main__':
    try:
        {'close': close, 'open': open_gate}[sys.argv[1]]()
    except Exception:
        # Config values and RCON output may contain secrets; keep diagnostics fixed.
        raise SystemExit('Connection gate failed; member connections remain locked.') from None
