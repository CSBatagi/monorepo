#!/usr/bin/env python3
"""Deploy prebuilt website files on the existing backend VM without building Next there."""
import datetime
import json
import pathlib
import subprocess
import sys

stage = pathlib.Path(sys.argv[1]).resolve()
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
targets = ['frontend-nextjs'] if '--frontend-only' in sys.argv else list(before)
backup = root / ('cosmetics-web-backup-' + stamp)
backup.mkdir(mode=0o700)
(backup / 'images.json').write_text(json.dumps(before, indent=2))
for name in targets:
    folder = stage / name
    (folder / 'Dockerfile').write_text(f'FROM {before[name]}\n' + ('COPY index.js cosmetics.js cosmeticsRoutes.js cosmeticProgression.js cosmeticProgressionStore.js /app/\nCOPY data/ /app/data/\n' if name == 'backend' else 'USER root\nRUN rm -rf /app/.next\nCOPY --chown=nextjs:nodejs .next /app/.next\n'))
    run('docker', 'build', '-t', f'csbatagi-cosmetics-{name}:{stamp}', str(folder))
override = root / 'docker-compose.cosmetics.yml'
images = {name: f'csbatagi-cosmetics-{name}:{stamp}' if name in targets else image for name, image in before.items()}
override.write_text('services:\n' + ''.join(f'  {name}:\n    image: {image}\n    pull_policy: never\n' for name, image in images.items()))
rollback = backup / 'rollback.yml'
rollback.write_text('services:\n' + ''.join(f'  {name}:\n    image: {image}\n    pull_policy: never\n' for name, image in before.items()))
run('docker', 'compose', '-f', str(root / 'docker-compose.yml'), '-f', str(override), 'up', '-d', '--no-deps', *targets, cwd=root)
print(f'Deployed. Rollback override: {rollback}')
