#!/usr/bin/env python3
"""Layer only updater backend files and prebuilt Next output onto current images."""
import datetime
import json
import pathlib
import subprocess
import sys

stage = pathlib.Path(sys.argv[1]).resolve()
root = pathlib.Path('/home/runner')
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ').lower()
def run(*args, **kw):
    return subprocess.run(args, check=True, text=True, **kw)
before = {}
for name in ['backend', 'frontend-nextjs']:
    inspection = json.loads(run('docker', 'inspect', f'runner-{name}-1', capture_output=True).stdout)[0]
    if inspection['HostConfig']['Memory'] != 256 * 1024 * 1024:
        raise SystemExit('Unexpected container memory budget')
    before[name] = inspection['Image']
backup = root / ('cs2-updates-web-backup-' + stamp)
backup.mkdir(mode=0o700)
(backup / 'images.json').write_text(json.dumps(before, indent=2))
for name in before:
    folder = stage / name
    instructions = 'COPY gameServer.js gameUpdateStatus.js /app/\n' if name == 'backend' else 'USER root\nRUN rm -rf /app/.next\nCOPY --chown=nextjs:nodejs .next /app/.next\n'
    (folder / 'Dockerfile').write_text(f'FROM {before[name]}\n' + instructions)
    run('docker', 'build', '-t', f'csbatagi-updates-{name}:{stamp}', str(folder))
override = root / 'docker-compose.cs2-updates.yml'
override.write_text('services:\n' + ''.join(f'  {name}:\n    image: csbatagi-updates-{name}:{stamp}\n    pull_policy: never\n' for name in before))
rollback = backup / 'rollback.yml'
rollback.write_text('services:\n' + ''.join(f'  {name}:\n    image: {image}\n    pull_policy: never\n' for name, image in before.items()))
run('docker', 'compose', '-f', str(root / 'docker-compose.yml'), '-f', str(override), 'up', '-d', '--no-deps', *before, cwd=root)
print('Deployed game-update UI and backend. Rollback:', rollback)
