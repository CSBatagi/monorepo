#!/usr/bin/env python3
"""Layer tested connection files onto production images, preserving installed fixes."""
import datetime
import json
import pathlib
import re
import shutil
import subprocess
import sys

stage = pathlib.Path(sys.argv[1]).resolve()
revision = sys.argv[2]
if not re.fullmatch(r'[a-f0-9]{40}', revision):
    raise SystemExit('Expected a full source revision')
root = pathlib.Path('/home/runner')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ').lower()

def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

before = {}
for name in ['backend', 'frontend-nextjs']:
    inspection = json.loads(run('docker', 'inspect', f'runner-{name}-1', capture_output=True).stdout)[0]
    if inspection['HostConfig']['Memory'] != 256 * 1024 * 1024:
        raise SystemExit('Unexpected container memory budget')
    before[name] = inspection['Image']
backup = root / ('cs2-connections-web-backup-' + stamp)
backup.mkdir(mode=0o700)
(backup / 'images.json').write_text(json.dumps(before, indent=2))
compose = root / 'docker-compose.yml'
shutil.copy2(compose, backup / compose.name)
secrets = root / '.backend_secrets'
if secrets.exists():
    shutil.copy2(secrets, backup / secrets.name)
    (backup / secrets.name).chmod(0o600)

for name, base in before.items():
    folder = stage / name
    instructions = ('COPY gameServer.js gameUpdateStatus.js gcp.js index.js rcon.js /app/\n' if name == 'backend' else
                    'USER root\nRUN rm -rf /app/.next\nCOPY --chown=nextjs:nodejs .next /app/.next\n')
    (folder / 'Dockerfile').write_text(f'FROM {base}\nLABEL org.opencontainers.image.revision="{revision}"\n' + instructions)
    run('docker', 'build', '-t', f'csbatagi-connections-{name}:{stamp}', str(folder))

# Preserve every other runtime setting; remove only the fixed private-host override.
compose.write_text(re.sub(r'^\s+CS2_RCON_HOST:.*\n', '', compose.read_text(), flags=re.M))
if secrets.exists():
    secrets.write_text(re.sub(r'^CS2_RCON_HOST=.*(?:\n|$)', '', secrets.read_text(), flags=re.M))
    secrets.chmod(0o600)
override = root / 'docker-compose.cs2-connections.yml'
override.write_text('services:\n' + ''.join(f'  {name}:\n    image: csbatagi-connections-{name}:{stamp}\n    pull_policy: never\n' for name in before))
rollback = backup / 'rollback.yml'
rollback.write_text('services:\n' + ''.join(f'  {name}:\n    image: {base}\n    pull_policy: never\n' for name, base in before.items()))
run('docker', 'compose', '-f', str(compose), '-f', str(override), 'up', '-d', '--no-deps', *before, cwd=root)
for name in before:
    inspection = json.loads(run('docker', 'inspect', f'runner-{name}-1', capture_output=True).stdout)[0]
    if inspection['HostConfig']['Memory'] != 256 * 1024 * 1024:
        raise SystemExit('Post-deployment memory budget mismatch')
    if name == 'backend' and any(v.startswith('CS2_RCON_HOST=') for v in inspection['Config']['Env']):
        raise SystemExit('Fixed RCON host is still configured')
print('Connection images deployed; verify API/readiness next. Backup:', backup)
