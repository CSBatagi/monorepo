"""Replace only website images, preserve host configuration, and verify stats."""
import datetime
import json
import pathlib
import re
import shutil
import subprocess
import sys


def run(*args, timeout=180):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        if '/tmp/verify-night-duels.cjs' in args:
            for line in (result.stdout + result.stderr).splitlines():
                try:
                    diagnostic = json.loads(line)
                    if diagnostic.get('verified') is False:
                        print(json.dumps({'verification_failed': str(diagnostic.get('reason', '')).splitlines()[0]}), flush=True)
                except (ValueError, TypeError, IndexError):
                    pass
        raise RuntimeError('Command failed: ' + args[0])
    return result.stdout


def main():
    revision = sys.argv[1]
    if not re.fullmatch(r'[a-f0-9]{40}', revision):
        raise RuntimeError('Expected an immutable revision')
    root = pathlib.Path('/srv/csbatagi')
    compose = root / 'docker-compose.yml'
    base = ['docker', 'compose', '-f', str(compose)]
    services = ['backend', 'frontend-nextjs']
    all_before = json.loads(run('docker', 'inspect', *run('docker', 'ps', '-q').split()))
    before = {item['Config'].get('Labels', {}).get('com.docker.compose.service'): item for item in all_before}
    images = {}
    for service in services:
        image = f'ghcr.io/csbatagi/monorepo/{service}:night-center-{revision}'
        run('docker', 'pull', image, timeout=600)
        info = json.loads(run('docker', 'image', 'inspect', image))[0]
        if info['Architecture'] != 'arm64' or info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != revision:
            raise RuntimeError('Image revision or architecture mismatch')
        images[service] = image
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ').lower()
    backup = root / ('night-center-backup-' + stamp)
    backup.mkdir(mode=0o700)
    shutil.copy2(compose, backup / 'docker-compose.yml')
    (backup / 'docker-compose.yml').chmod(0o600)

    def overlay(path, values):
        path.write_text('services:\n' + ''.join(f'  {name}:\n    image: {image}\n    pull_policy: never\n' for name, image in values.items()))
        path.chmod(0o600)

    rollback = backup / 'rollback.yml'
    overlay(rollback, {name: before[name]['Image'] for name in services})
    target = root / 'docker-compose.night-center.yml'
    overlay(target, images)
    try:
        run(*base, '-f', str(target), 'up', '-d', '--no-deps', *services)
        after = json.loads(run('docker', 'inspect', *run('docker', 'ps', '-q').split()))
        current = {item['Config'].get('Labels', {}).get('com.docker.compose.service'): item for item in after}
        for name in services:
            item = current[name]
            if item['State']['OOMKilled'] or item['HostConfig']['Memory'] != before[name]['HostConfig']['Memory']:
                raise RuntimeError('Website memory settings changed')
        for name, item in before.items():
            if name and name not in services and current.get(name, {}).get('Id') != item['Id']:
                raise RuntimeError('Unrelated service restarted')
        container = current['backend']['Id']
        run('docker', 'cp', str(pathlib.Path(__file__).with_name('verify-night-duels.cjs')), container + ':/tmp/verify-night-duels.cjs')
        result = run('docker', 'exec', container, 'node', '/tmp/verify-night-duels.cjs', timeout=600)
        # The reviewed checker emits only a sanitized JSON result.
        report = json.loads(result.strip().splitlines()[-1])
        if report.get('verified') is not True:
            raise RuntimeError('Production verification failed')
        print(json.dumps({'revision': revision, 'rollback': str(rollback), 'unrelatedServicesPreserved': True, **report}), flush=True)
    except Exception:
        run(*base, '-f', str(rollback), 'up', '-d', '--no-deps', *services)
        print(json.dumps({'rolledBack': True, 'rollback': str(rollback)}), flush=True)
        raise


if __name__ == '__main__':
    main()
