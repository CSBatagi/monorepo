#!/usr/bin/env python3
"""Run the narrow native repair from the backend's trusted private IP."""
import json
import pathlib
import subprocess


def main():
    root = pathlib.Path.home()
    admin = dict(line.split('=', 1) for line in (root / '.teamspeak_server_secrets').read_text().splitlines() if '=' in line)
    ids = subprocess.run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=backend'], capture_output=True, text=True, check=True).stdout.split()
    assert len(ids) == 1
    subprocess.run(['docker', 'cp', str(root / '.csbatagi-teamspeak-ops' / 'repair-production.cjs'), ids[0] + ':/tmp/repair-teamspeak.cjs'], capture_output=True, text=True, check=True)
    result = subprocess.run(['docker', 'exec', '-i', ids[0], 'node', '/tmp/repair-teamspeak.cjs'], input=json.dumps({'adminPassword': admin['TS3SERVER_SERVERADMIN_PASSWORD']}), capture_output=True, text=True, timeout=60)
    # Only the reviewed helper's structured, non-sensitive diagnostics leave host.
    for line in (result.stdout + result.stderr).splitlines():
        try:
            data = json.loads(line)
            if any(key in data for key in ['identity_write_permission_repaired', 'administrative_denial_checks_passed', 'native_identity_write_readback_passed', 'temporary_probe_removed', 'repair_failed']):
                print(json.dumps(data), flush=True)
        except ValueError:
            pass
    if result.returncode:
        raise RuntimeError('Private repair failed')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'repair_failed': True, 'credentials_logged': False}))
        raise SystemExit(1)
