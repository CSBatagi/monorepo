#!/usr/bin/env python3
"""Run sanitized live checks inside the backend without exposing its environment."""
import json
import pathlib
import subprocess
import time


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError('Operation failed')
    return result.stdout


def main():
    ids = run('docker', 'ps', '-q').split()
    items = json.loads(run('docker', 'inspect', *ids))
    backend = next(item for item in items if item['Config'].get('Labels', {}).get('com.docker.compose.service') == 'backend')
    teamspeak = next(item for item in items if item['Name'] == '/teamspeak-server')
    ports = teamspeak['HostConfig']['PortBindings'].get('10011/tcp', [])
    assert ports and all(port['HostIp'] == '127.0.0.1' for port in ports)
    root = pathlib.Path.home()
    assert all((root / name).stat().st_mode & 0o777 == 0o600 for name in ['.teamspeak_secrets', '.teamspeak_server_secrets'])
    source = root / '.csbatagi-teamspeak-ops' / 'verify-live.cjs'
    run('docker', 'cp', str(source), backend['Id'] + ':/tmp/verify-teamspeak-live.cjs')
    deadline = time.monotonic() + 150
    while True:
        result = subprocess.run(['docker', 'exec', backend['Id'], 'node', '/tmp/verify-teamspeak-live.cjs'], capture_output=True, text=True, timeout=160)
        # Only this reviewed checker generates output; it never prints sessions,
        # query replies, credentials or member identifiers.
        for line in (result.stdout + result.stderr).splitlines():
            try:
                data = json.loads(line)
                if 'live_checks_passed' in data or 'live_validation_failed' in data:
                    print(json.dumps(data), flush=True)
            except ValueError:
                pass
        if result.returncode == 0:
            print(json.dumps({'query_port_localhost_only': True, 'private_file_modes': '0600'})); return
        if data.get('completed_checks'):
            raise RuntimeError('Validation failed after startup; do not retry deterministic policy checks')
        if time.monotonic() >= deadline:
            raise RuntimeError('Live validation failed')
        time.sleep(10)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'validation_failed': True, 'credentials_logged': False}))
        raise SystemExit(1)
