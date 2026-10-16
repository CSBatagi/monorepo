#!/usr/bin/env python3
"""Repair the outside-GCP website's private RCON path without replacing images."""
import datetime
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout


def patch_compose(current, source):
    block = re.search(r'(?ms)^  cs2-rcon-tunnel:\n.*?(?=^  [a-zA-Z0-9_-]+:\n)', source)
    if not block:
        raise ValueError('missing_tunnel_service')
    if re.search(r'^  cs2-rcon-tunnel:', current, re.M):
        current = re.sub(r'(?ms)^  cs2-rcon-tunnel:\n.*?(?=^  [a-zA-Z0-9_-]+:\n)', block[0], current, count=1)
    else:
        if current.count('  backend:\n') != 1:
            raise ValueError('ambiguous_backend_service')
        current = current.replace('  backend:\n', block[0] + '  backend:\n', 1)
    # Change only the backend's override; preserve unrelated host configuration.
    match = re.search(r'(?ms)^  backend:\n.*?(?=^  [a-zA-Z0-9_-]+:\n)', current)
    if not match:
        raise ValueError('missing_backend_service')
    backend = match[0]
    if re.search(r'^      CS2_RCON_HOST:', backend, re.M):
        backend = re.sub(r'^      CS2_RCON_HOST:.*$', '      CS2_RCON_HOST: cs2-rcon-tunnel', backend, flags=re.M)
    else:
        backend, count = re.subn(r'(^      CS2_GCP_ZONE:.*\n)', r'\1      CS2_RCON_HOST: cs2-rcon-tunnel\n', backend, count=1, flags=re.M)
        if count != 1:
            raise ValueError('missing_game_configuration')
    if '      - cs2-rcon-tunnel\n' not in backend:
        backend, count = re.subn(r'(^    depends_on:\n)', r'\1      - cs2-rcon-tunnel\n', backend, count=1, flags=re.M)
        if count != 1:
            raise ValueError('missing_backend_dependencies')
    return current[:match.start()] + backend + current[match.end():]


def main():
    if sys.argv[1:] not in [[], ['--apply']]:
        raise ValueError('invalid_operation')
    stage = pathlib.Path(__file__).resolve().parent
    root = pathlib.Path('/srv/csbatagi')
    compose = root / 'docker-compose.yml'
    containers = run('docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=backend').split()
    if len(containers) != 1:
        raise ValueError('backend_not_unique')
    backend_id = containers[0]
    backend = json.loads(run('docker', 'inspect', backend_id))[0]
    print(json.dumps({'hostArchitecture': run('uname', '-m').strip(),
        'hostMemoryKiB': int(re.search(r'MemTotal:\s+(\d+)', pathlib.Path('/proc/meminfo').read_text())[1]),
        'backendRunning': backend['State']['Running'], 'backendOom': backend['State']['OOMKilled'],
        'composeProject': backend['Config']['Labels']['com.docker.compose.project']}), flush=True)

    def probe(mode, container=backend_id):
        run('docker', 'cp', str(stage / 'control-path-probe.cjs'), container + ':/tmp/cs2-control-path-probe.cjs')
        result = subprocess.run(['docker', 'exec', container, 'node', '/tmp/cs2-control-path-probe.cjs', mode],
                                capture_output=True, text=True, timeout=60)
        # The reviewed probe emits sanitized structured records only.
        for line in result.stdout.splitlines():
            if line.startswith('{'):
                print(json.dumps(json.loads(line)), flush=True)
        if result.returncode:
            raise RuntimeError('control_probe_failed')

    probe('audit')
    if sys.argv[1:] != ['--apply']:
        return
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = root / ('cs2-control-backup-' + stamp)
    backup.mkdir(mode=0o700)
    shutil.copy2(compose, backup / 'docker-compose.yml')
    (backup / 'docker-compose.yml').chmod(0o600)
    pin = backup / 'keep-backend-image.json'
    pin.write_text(json.dumps({'services': {'backend': {'image': backend['Image'], 'pull_policy': 'never'}}}))
    pin.chmod(0o600)
    old = compose.read_text()
    updated = patch_compose(old, (stage / 'docker-compose.yml').read_text())
    candidate = backup / 'candidate.yml'
    candidate.write_text(updated)
    candidate.chmod(0o600)
    base = ['docker', 'compose', '--project-directory', str(root), '--project-name',
            backend['Config']['Labels']['com.docker.compose.project']]
    # Validate privately: Compose output can contain secret env-file values.
    run(*base, '-f', str(candidate), 'config', '--quiet', timeout=60)
    compose.write_text(updated)
    try:
        run(*base, '-f', str(compose), 'pull', 'cs2-rcon-tunnel', timeout=420)
        run(*base, '-f', str(compose), 'up', '-d', '--no-deps', '--pull', 'never', 'cs2-rcon-tunnel', timeout=60)
        # The container can take a few seconds to authenticate and bind its listener.
        deadline = time.monotonic() + 45
        while True:
            try:
                probe('tunnel')  # Query CS2 before restarting the website backend.
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(5)
        run(*base, '-f', str(compose), '-f', str(pin), 'up', '-d', '--no-deps', '--pull', 'never', 'backend', timeout=90)
        new_id = run('docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=backend').strip()
        after = json.loads(run('docker', 'inspect', new_id))[0]
        if after['Image'] != backend['Image'] or after['HostConfig']['Memory'] != backend['HostConfig']['Memory']:
            raise RuntimeError('backend_image_or_limit_changed')
        print(json.dumps({'privateControlInstalled': True, 'backup': str(backup),
            'backendImagePreserved': True, 'backendMemoryLimitPreserved': True}), flush=True)
        # Leave final API validation to the workflow after the backend starts listening.
    except Exception:
        compose.write_text(old)
        run(*base, '-f', str(compose), '-f', str(pin), 'up', '-d', '--no-deps', '--pull', 'never', 'backend', timeout=90)
        print(json.dumps({'rollbackRestoredBackend': True, 'backup': str(backup)}), flush=True)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Subprocess exceptions may include host configuration; do not print them.
        print(json.dumps({'privateControlOperationFailed': type(error).__name__}), flush=True)
        raise SystemExit(1)
