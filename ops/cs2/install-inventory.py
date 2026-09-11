#!/usr/bin/env python3
"""Install the staged, compiled cosmetics plugin on the existing empty game VM."""
import datetime
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys

stage = pathlib.Path(sys.argv[1]).resolve()
game = pathlib.Path('/home/steam/cs2/game/csgo')
css = game / 'addons/counterstrikesharp'
spec = importlib.util.spec_from_file_location('local_rcon', '/usr/local/lib/csbatagi/rcon-local.py')
rcon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rcon)
status = json.loads(rcon.command('csbatagi_status'))
if any(status.get(key) for key in ['live', 'preparing', 'recording', 'matchLoaded', 'humans']) or status.get('uploads', {}).get('pending') != 0:
    raise SystemExit('Refusing installation: server is occupied, a match is loaded, or uploads are pending.')
for required in ['plugins/InventorySimulator/InventorySimulator.dll', 'plugins/InventorySimulator/lang/en.json', 'gamedata/inventory-simulator.json', 'inventory.cfg']:
    if not (stage / required).is_file():
        raise SystemExit(f'Missing staged file: {required}')
if not (game / 'cfg/csbatagi-web-token').is_file():
    raise SystemExit('Private website token is missing.')
backup = pathlib.Path('/home/steam') / ('inventory-backup-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700)
paths = ['addons/counterstrikesharp/configs/core.json', 'cfg/server.cfg', 'cfg/csbatagi-inventory.cfg', 'addons/counterstrikesharp/plugins/InventorySimulator', 'addons/counterstrikesharp/gamedata/inventory-simulator.json']
manifest = []
for relative in paths:
    source = game / relative
    manifest.append({'path': relative, 'existed': source.exists()})
    if source.exists():
        destination = backup / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir(): shutil.copytree(source, destination)
        else: shutil.copy2(source, destination)
(backup / 'manifest.json').write_text(json.dumps(manifest))
subprocess.run(['systemctl', 'stop', 'cs2'], check=True)
try:
    shutil.copytree(stage / 'plugins/InventorySimulator', css / 'plugins/InventorySimulator', dirs_exist_ok=True)
    shutil.copy2(stage / 'gamedata/inventory-simulator.json', css / 'gamedata/inventory-simulator.json')
    shutil.copy2(stage / 'inventory.cfg', game / 'cfg/csbatagi-inventory.cfg')
    core = json.loads((css / 'configs/core.json').read_text())
    core['FollowCS2ServerGuidelines'] = False
    (css / 'configs/core.json').write_text(json.dumps(core, indent=2))
    server = game / 'cfg/server.cfg'
    text = server.read_text()
    if 'exec csbatagi-inventory.cfg' not in text:
        server.write_text(text.rstrip() + '\nexec csbatagi-inventory.cfg\n')
    subprocess.run(['chown', '-R', 'steam:steam', str(css / 'plugins/InventorySimulator')], check=True)
    for path in [css / 'configs/core.json', css / 'gamedata/inventory-simulator.json', server, game / 'cfg/csbatagi-inventory.cfg']:
        shutil.chown(path, user='steam', group='steam')
except Exception:
    # Preserve failed files for diagnosis, then restore the prior installation before restarting.
    for entry in manifest:
        relative = entry['path']
        current = game / relative
        if current.exists():
            failed = backup / 'failed' / relative
            failed.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(current), str(failed))
        if entry['existed']:
            previous = backup / relative
            current.parent.mkdir(parents=True, exist_ok=True)
            if previous.is_dir(): shutil.copytree(previous, current)
            else: shutil.copy2(previous, current)
    raise
finally:
    subprocess.run(['systemctl', 'start', 'cs2'], check=True)
print(f'Installed. Backup: {backup}. Verify css_plugins list, cosmetics commands, MatchZy and csbatagi_status.')
