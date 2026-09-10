#!/usr/bin/env python3
"""Install staged, pinned packages after SteamCMD has finished. Run as root."""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import tarfile
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
GAME = pathlib.Path('/home/steam/cs2/game/csgo')
PACKAGES = pathlib.Path('/home/steam/resurrection-packages')
if subprocess.run(['pgrep', '-x', 'steamcmd'], stdout=subprocess.DEVNULL).returncode == 0:
    raise SystemExit('SteamCMD is still running; do not install over an update.')
if subprocess.run(['pgrep', '-x', 'cs2'], stdout=subprocess.DEVNULL).returncode == 0:
    raise SystemExit('Stop CS2 before installation.')
if "Success! App '730' fully installed." not in pathlib.Path('/home/steam/resurrection-update.log').read_text(errors='replace'):
    raise SystemExit('Game update did not report success.')

secret_path = GAME / 'cfg/csbatagi_secrets.cfg'
old_config = (GAME / 'cfg/server.cfg').read_text()
if secret_path.exists():
    old_config = secret_path.read_text()
secret_lines = [line for line in old_config.splitlines() if re.match(r'^\s*(rcon_password|sv_password|sv_setsteamaccount)\s+', line)]
secret_lines += [line for line in old_config.splitlines() if re.match(r'^\s*matchzy_loadmatch_.*header.*\s+', line)]
if not any(line.startswith('rcon_password') for line in secret_lines):
    raise SystemExit('RCON secret missing; preserve/recover it before installing.')
saved = {}
for rel in ['addons/counterstrikesharp/configs/admins.json', 'cfg/MatchZy/admins.json']:
    path = GAME / rel
    if path.exists():
        saved[rel] = path.read_bytes()

metamod = PACKAGES / 'metamod-1411.tar.gz'
if hashlib.sha256(metamod.read_bytes()).hexdigest() != 'e3d4c3d457a1c86a5079e8bd8248a4a00361c7d0a3dce7c7e0c4c45458096649':
    raise SystemExit('Unexpected Metamod package; use the tested build 1411.')
with tarfile.open(metamod) as archive:
    archive.extractall(GAME, filter='data')
with zipfile.ZipFile(PACKAGES / 'css.zip') as archive:
    archive.extractall(GAME)
plugin = GAME / 'addons/counterstrikesharp/plugins/MatchZy'
if plugin.exists():
    import time
    plugin.rename(pathlib.Path('/home/steam/resurrection_backup_20260910') / ('MatchZy-before-' + str(time.time_ns())))
plugin.mkdir(parents=True)
with tarfile.open('/tmp/csbatagi-matchzy.tgz') as archive:
    archive.extractall(plugin, filter='data')
with tarfile.open('/tmp/csbatagi-matchzy-cfg.tgz') as archive:
    archive.extractall(GAME / 'cfg', filter='data')
for rel, data in saved.items():
    (GAME / rel).write_bytes(data)

(GAME / 'cfg/csbatagi_secrets.cfg').write_text('\n'.join(secret_lines) + '\n')
(GAME / 'cfg/csbatagi_secrets.cfg').chmod(0o640)
for name in ['server.cfg', 'warmup.cfg', 'live_override.cfg']:
    destination = GAME / 'cfg' / (name if name == 'server.cfg' else 'MatchZy/' + name)
    shutil.copy2(HERE / name, destination)
(GAME / 'cfg/MatchZy/config.cfg').open('a').write('\n' + (HERE / 'matchzy-override.cfg').read_text() + '\n')
(GAME / 'cfg/MatchZy/humans.cfg').write_text('// CS Batagi manages warmup bots and protects CSTV.\n')
# Remove stale generic kicks from every installed MatchZy config.
for path in (GAME / 'cfg/MatchZy').glob('*.cfg'):
    path.write_text(re.sub(r'(?m)^\s*bot_kick\s*$', '// gameplay bots are removed by CS Batagi', path.read_text()))
gameinfo = GAME / 'gameinfo.gi'
text = gameinfo.read_text()
if 'csgo/addons/metamod' not in text:
    text, count = re.subn(r'(SearchPaths\s*\{)', r'\1\n\t\t\tGame csgo/addons/metamod', text, count=1)
    if count != 1:
        raise SystemExit('Cannot locate gameinfo search paths.')
    gameinfo.write_text(text)

(GAME / 'demos').mkdir(exist_ok=True)
(GAME / 'csbatagi-state').mkdir(exist_ok=True)
(GAME / 'MatchZyDataBackup').mkdir(exist_ok=True)
subprocess.run(['chown', 'steam:steam', str(GAME), str(GAME / 'MatchZyDataBackup')], check=True)
(GAME / 'cfg/gamemode_competitive_server.cfg').write_text('exec server.cfg\ntv_delay 0\nbot_quota 0\n')
target = pathlib.Path('/usr/local/lib/csbatagi')
target.mkdir(parents=True, exist_ok=True)
for name in ['launch.py', 'rcon-local.py', 'demo-uploader.py']:
    shutil.copy2(HERE / name, target / name)
    (target / name).chmod(0o755)
for name in ['cs2.service', 'csbatagi-demos.service']:
    shutil.copy2(HERE / name, pathlib.Path('/etc/systemd/system') / name)
shutil.copy2(HERE / 'cs2.logrotate', '/etc/logrotate.d/csbatagi-cs2')
subprocess.run(['chown', '-R', 'steam:steam', str(GAME / 'addons'), str(GAME / 'cfg'), str(GAME / 'demos'), str(GAME / 'csbatagi-state')], check=True)
versions = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in PACKAGES.iterdir() if p.is_file()}
versions['MatchZy.dll'] = hashlib.sha256((plugin / 'MatchZy.dll').read_bytes()).hexdigest()
(PACKAGES / 'installed-sha256.json').write_text(json.dumps(versions, indent=2))
subprocess.run(['systemctl', 'daemon-reload'], check=True)
subprocess.run(['systemctl', 'enable', 'cs2.service', 'csbatagi-demos.service'], check=True)
print('Installed pinned stack and services; no game started yet.')
