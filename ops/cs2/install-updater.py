#!/usr/bin/env python3
"""Install the managed updater on the existing empty VM. Run as root."""
import datetime
import importlib.util
import json
import pathlib
import shutil
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
TARGET = pathlib.Path('/usr/local/lib/csbatagi')
ROOT = pathlib.Path('/home/steam/csbatagi-updates')

if subprocess.run(['pgrep', '-x', 'cs2'], stdout=subprocess.DEVNULL).returncode == 0:
    spec = importlib.util.spec_from_file_location('rcon', TARGET / 'rcon-local.py')
    rcon = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rcon)
    state = json.loads(rcon.command('csbatagi_status'))
    if any(state.get(k) for k in ['humans', 'matchLoaded', 'live', 'preparing', 'recording']):
        raise SystemExit('Server occupied; installation refused.')
    uploads = state.get('uploads', {})
    import time
    if uploads.get('pending') != 0 or time.time() - uploads.get('updatedAt', 0) > 120:
        raise SystemExit('Unverified uploads; installation refused.')
subprocess.run(['systemctl', 'stop', 'cs2'], check=True)
if subprocess.run(['pgrep', '-x', 'steamcmd'], stdout=subprocess.DEVNULL).returncode == 0:
    raise SystemExit('SteamCMD is running; installation refused.')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = pathlib.Path('/home/steam/csbatagi-backups') / ('updater-' + stamp)
backup.mkdir(mode=0o700, parents=True)
files = ['update-stack.py', 'gate.sh', 'connection-gate.py', 'sdr.py', 'launch.py', 'rcon-local.py', 'verify-start.sh', 'patch-matchzy.py', 'CSBatagi.cs',
         'patch-inventory.py', 'CSBatagiInventory.cs']
services = ['cs2.service', 'csbatagi-update-status.service']
manifest = []
for name, destination in [(n, TARGET / n) for n in files] + [(n, pathlib.Path('/etc/systemd/system') / n) for n in services]:
    manifest.append({'path': str(destination), 'existed': destination.exists()})
    if destination.exists():
        shutil.copy2(destination, backup / name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HERE / name, destination)
    destination.chmod(0o755 if name.endswith(('.py', '.sh')) else 0o644)
    shutil.chown(destination, user='root', group='root')
(backup / 'manifest.json').write_text(json.dumps(manifest, indent=2))
ROOT.mkdir(mode=0o750, exist_ok=True)
shutil.chown(ROOT, user='steam', group='steam')
spec = importlib.util.spec_from_file_location('sdr', TARGET / 'sdr.py')
sdr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdr)
config = pathlib.Path('/home/steam/cs2/game/csgo/cfg/server.cfg')
shutil.copy2(config, backup / 'server.cfg')
config.write_text(sdr.gate_config(config.read_text()))
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', 'cs2', 'csbatagi-update-status'], check=True)
subprocess.run([str(TARGET / 'gate.sh'), 'close'], check=True)
subprocess.run(['systemctl', 'start', 'csbatagi-update-status'], check=True)
subprocess.run(['systemctl', 'reset-failed', 'cs2'], check=True)
print('Installed updater; public UDP closed. Backup:', backup)
print('Start with systemctl start --no-block cs2; inspect csbatagi-updates/status.json.')
