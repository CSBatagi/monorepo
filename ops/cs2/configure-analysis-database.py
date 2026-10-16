#!/usr/bin/env python3
"""Switch only the analyzer's DB route, retaining its existing restricted credential."""
import datetime
import json
import os
import pathlib
import pwd
import shutil
import subprocess
import sys
import time

SETTINGS = pathlib.Path('/home/steam/.config/csdm/settings.json')
WORKER = pathlib.Path('/usr/local/lib/csbatagi/demo-analyzer.py')


def test_database(database):
    try:
        result = subprocess.run(['psql', '-X', '-h', str(database['hostname']), '-p', str(database['port']),
            '-U', str(database['username']), '-d', str(database['database']), '-Atc',
            'SELECT max(schema_version) FROM migrations'], env={**os.environ, 'PGPASSWORD': database['password'],
            'PGCONNECT_TIMEOUT': '5', 'PGOPTIONS': '-c statement_timeout=5000'},
            capture_output=True, text=True, timeout=8)
        return result.returncode == 0, result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return False, None


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else 'audit'
    if mode not in ['audit', 'apply']:
        raise ValueError('invalid_mode')
    original = json.loads(SETTINGS.read_text())
    database = original['database']
    wanted = {**database, 'hostname': '127.0.0.1', 'port': 15432}
    current_ok, version = test_database(database)
    tunnel_ok, tunnel_version = test_database(wanted)
    print(json.dumps({'currentHost': database['hostname'], 'currentPort': database['port'],
        'currentDatabaseLogin': current_ok, 'privateTunnelLogin': tunnel_ok, 'schemaVersion': tunnel_version or version}), flush=True)
    if mode != 'apply':
        return
    deadline = time.monotonic() + 120
    while not tunnel_ok and time.monotonic() < deadline:
        time.sleep(5)
        tunnel_ok, tunnel_version = test_database(wanted)
    if not tunnel_ok:
        raise RuntimeError('private_database_login_failed')
    # Do not interrupt a running CLI insertion.
    deadline = time.monotonic() + 180
    while subprocess.run(['pgrep', '-f', '[c]li.js analyze'], stdout=subprocess.DEVNULL).returncode == 0:
        if time.monotonic() >= deadline:
            raise RuntimeError('analysis_still_running')
        time.sleep(5)
    stage = pathlib.Path(__file__).resolve().parent
    subprocess.run(['python3', '-m', 'py_compile', str(stage / 'demo-analyzer.py')], check=True)
    backup = pathlib.Path('/home/steam/csbatagi-backups') / ('analysis-db-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(SETTINGS, backup / 'settings.json')
    shutil.copy2(WORKER, backup / WORKER.name)
    subprocess.run(['systemctl', 'stop', 'csbatagi-analyzer'], check=True)
    try:
        updated = {**original, 'database': wanted, 'csbatagiDatabaseTransport': 'iap-reverse-ssh'}
        partial = SETTINGS.with_suffix('.json.part')
        with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
            json.dump(updated, stream, indent=2)
        steam = pwd.getpwnam('steam')
        os.chown(partial, steam.pw_uid, steam.pw_gid)
        partial.replace(SETTINGS)
        shutil.copyfile(stage / 'demo-analyzer.py', WORKER)
        WORKER.chmod(0o755)
    except Exception:
        shutil.copy2(backup / 'settings.json', SETTINGS)
        shutil.copy2(backup / WORKER.name, WORKER)
        raise
    finally:
        subprocess.run(['systemctl', 'start', 'csbatagi-analyzer'], check=True)
    print(json.dumps({'analyzerDatabaseRepaired': True, 'passwordPreserved': True,
        'schemaVersion': tunnel_version, 'backup': str(backup), 'gameRestarted': False}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'analyzerDatabaseSetupFailed': type(error).__name__}), flush=True)
        raise SystemExit(1)
