#!/usr/bin/env python3
"""Run the narrow native repair from the backend's trusted private IP."""
import json
import pathlib
import subprocess
import time


def main():
    root = pathlib.Path.home()
    admin = dict(line.split('=', 1) for line in (root / '.teamspeak_server_secrets').read_text().splitlines() if '=' in line)
    ids = subprocess.run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=backend'], capture_output=True, text=True, check=True).stdout.split()
    assert len(ids) == 1
    backend = json.loads(subprocess.run(['docker', 'inspect', ids[0]], capture_output=True, text=True, check=True).stdout)[0]
    network = backend['NetworkSettings']['Networks']['db2']
    allowlist = root / '.csbatagi-teamspeak-ops' / 'query-ip-allowlist.txt'
    allowlist.write_text('127.0.0.1\n::1\n' + network['IPAddress'] + '\n' + network['Gateway'] + '\n')
    allowlist.chmod(0o644)  # IPs are not credentials; the native UID must read them.
    for name in ['query_ip_allowlist.txt', 'query_ip_whitelist.txt']:
        subprocess.run(['docker', 'cp', str(allowlist), 'teamspeak-server:/var/ts3server/' + name], capture_output=True, text=True, check=True)
    print(json.dumps({'query_allowlist_updated_for_current_private_ips': True, 'teamspeak_restarted': False}), flush=True)
    subprocess.run(['docker', 'cp', str(root / '.csbatagi-teamspeak-ops' / 'repair-production.cjs'), ids[0] + ':/tmp/repair-teamspeak.cjs'], capture_output=True, text=True, check=True)
    # Native TeamSpeak reloads the IP allowlist every five minutes. Preserve
    # active voice clients and retry only query-flood/disconnect failures.
    deadline = time.monotonic() + 360
    while True:
        result = subprocess.run(['docker', 'exec', '-i', ids[0], 'node', '/tmp/repair-teamspeak.cjs'], input=json.dumps({'adminPassword': admin['TS3SERVER_SERVERADMIN_PASSWORD']}), capture_output=True, text=True, timeout=60)
        retryable = False
        for line in (result.stdout + result.stderr).splitlines():
            try:
                data = json.loads(line)
                if any(key in data for key in ['identity_write_permission_repaired', 'administrative_denial_checks_passed', 'native_identity_write_readback_passed', 'temporary_probe_removed', 'repair_failed']):
                    print(json.dumps(data), flush=True)
                if data.get('repair_failed') and (data.get('query_code') == '524' or data.get('phase') == 'private bootstrap login' and data.get('error_type') == 'Error' and data.get('query_code') is None):
                    retryable = True
            except ValueError:
                pass
        if result.returncode == 0:
            return
        if not retryable or time.monotonic() >= deadline:
            raise RuntimeError('Private repair failed')
        time.sleep(15)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'repair_failed': True, 'credentials_logged': False}))
        raise SystemExit(1)
