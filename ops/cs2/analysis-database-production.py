#!/usr/bin/env python3
"""Install only the private analyzer DB tunnel; preserve all running application containers."""
import datetime
import json
import pathlib
import re
import shutil
import subprocess
import sys

SERVICE = 'cs2-analysis-db-tunnel'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout


def patch_compose(current, source):
    pattern = r'(?ms)^  cs2-analysis-db-tunnel:\n.*?(?=^  [a-zA-Z0-9_-]+:\n)'
    block = re.search(pattern, source)
    if not block:
        raise ValueError('missing_tunnel_service')
    if re.search(r'^  cs2-analysis-db-tunnel:', current, re.M):
        return re.sub(pattern, lambda _: block[0], current, count=1)
    if current.count('  cs2-rcon-tunnel:\n') != 1:
        raise ValueError('unexpected_host_configuration')
    return current.replace('  cs2-rcon-tunnel:\n', block[0] + '  cs2-rcon-tunnel:\n', 1)


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else 'audit'
    if mode not in ['audit', 'apply', 'retry', 'verify']:
        raise ValueError('invalid_operation')
    stage = pathlib.Path(__file__).resolve().parent
    root = pathlib.Path('/srv/csbatagi')
    compose = root / 'docker-compose.yml'
    ids = run('docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=backend').split()
    if len(ids) != 1:
        raise ValueError('backend_not_unique')
    backend_id = ids[0]
    backend = json.loads(run('docker', 'inspect', backend_id))[0]
    existing = {name: run('docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=' + name).strip()
                for name in ['backend', 'frontend-nextjs', 'postgres', 'cs2-rcon-tunnel']}
    mem_kib = int(re.search(r'MemTotal:\s+(\d+)', pathlib.Path('/proc/meminfo').read_text())[1])
    print(json.dumps({'hostMemoryKiB': mem_kib, 'applicationContainersPresent': {name: bool(value) for name, value in existing.items()}}), flush=True)
    for tunnel_id in run('docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.service=' + SERVICE).split():
        tunnel = json.loads(run('docker', 'inspect', tunnel_id))[0]
        logs = subprocess.run(['docker', 'logs', '--tail', '25', tunnel_id], capture_output=True, text=True)
        text = logs.stdout + logs.stderr
        print(json.dumps({'tunnelRunning': tunnel['State']['Running'], 'tunnelRestarts': tunnel['RestartCount'],
            'tunnelOom': tunnel['State']['OOMKilled'], 'tunnelPublishesHostPorts': bool(tunnel['HostConfig']['PortBindings']),
            'tunnelErrors': [line[:250] for line in text.splitlines() if line.startswith(('ERROR:', 'ssh:', 'Warning:'))
                and not re.search(r'password|token|authorization|private_key', line, re.I)][-4:]}), flush=True)

    if mode == 'apply':
        if mem_kib < 4 * 1024 * 1024 or (root / 'credentials.json').stat().st_uid != 1000:
            raise ValueError('host_budget_or_credential_owner_mismatch')
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = root / ('analysis-db-backup-' + stamp)
        backup.mkdir(mode=0o700)
        shutil.copy2(compose, backup / 'docker-compose.yml')
        old = compose.read_text()
        known = root / 'game-ssh-known-hosts'
        wanted = (stage / 'game-ssh-known-hosts').read_text()
        if known.exists() and known.read_text() != wanted:
            raise ValueError('host_key_changed')
        known.write_text(wanted)
        known.chmod(0o644)  # Public host key, independently verified through GCP.
        candidate = backup / 'candidate.yml'
        candidate.write_text(patch_compose(old, (stage / 'docker-compose.yml').read_text()))
        base = ['docker', 'compose', '--project-directory', str(root), '--project-name',
                backend['Config']['Labels']['com.docker.compose.project']]
        run(*base, '-f', str(candidate), 'config', '--quiet', timeout=60)
        compose.write_text(candidate.read_text())
        try:
            run(*base, '-f', str(compose), 'pull', SERVICE, timeout=420)
            run(*base, '-f', str(compose), 'up', '-d', '--no-deps', '--pull', 'never', SERVICE, timeout=60)
        except Exception:
            compose.write_text(old)
            print(json.dumps({'composeRestored': True, 'backup': str(backup)}), flush=True)
            raise
        after = {name: run('docker', 'ps', '-q', '--filter', 'label=com.docker.compose.service=' + name).strip() for name in existing}
        if after != existing:
            raise RuntimeError('application_container_changed')
        print(json.dumps({'analysisTunnelInstalled': True, 'existingContainersPreserved': True, 'backup': str(backup)}), flush=True)

    run('docker', 'cp', str(stage / 'analysis-recovery.cjs'), backend_id + ':/tmp/analysis-recovery.cjs')
    result = subprocess.run(['docker', 'exec', backend_id, 'node', '/tmp/analysis-recovery.cjs', mode if mode in ['retry', 'verify'] else 'audit'],
                            capture_output=True, text=True, timeout=90)
    for line in (result.stdout + result.stderr).splitlines():
        if line.startswith('{'):
            print(json.dumps(json.loads(line)), flush=True)
    if result.returncode:
        raise RuntimeError('analysis_probe_failed')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'analysisDatabaseOperationFailed': type(error).__name__}), flush=True)
        raise SystemExit(1)
