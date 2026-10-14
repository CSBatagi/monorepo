#!/usr/bin/env python3
"""Deploy immutable ARM images and provision key-free TeamSpeak verification.

Only sanitized progress leaves this process. Docker Env, stdout containing
credentials, database contents, private files and raw container logs stay local.
"""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import time


def run(*args, input=None, timeout=180):
    result = subprocess.run(args, input=input, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        report({'operation_failed': args[0], 'subcommand': args[1] if len(args) > 1 and args[1] in ['exec', 'cp', 'compose', 'pull', 'stop', 'inspect', 'image'] else None, 'exit_code': result.returncode})
        # Numeric setup diagnostics are safe; never print raw Docker/tool output.
        if 'setupTeamSpeak.js' in ' '.join(args):
            try:
                diagnostic = json.loads(result.stderr)
                report({'setup_failed': True, 'query_code': diagnostic.get('queryCode'), 'permission_id': diagnostic.get('failedPermission'), 'command': diagnostic.get('command')})
            except (ValueError, TypeError):
                pass
        raise RuntimeError('Operation failed: ' + args[0])
    return result.stdout


def report(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def private_write(path, text):
    path.write_text(text)
    path.chmod(0o600)


def containers():
    ids = run('docker', 'ps', '-aq').split()
    return json.loads(run('docker', 'inspect', *ids))


def service(items, name):
    found = [item for item in items if item['Config'].get('Labels', {}).get('com.docker.compose.service') == name]
    if len(found) != 1:
        raise RuntimeError('Expected one service: ' + name)
    return found[0]


def block(text, name):
    match = re.search(r'(?ms)^  ' + re.escape(name) + r':\n.*?(?=^  [a-z][a-z0-9-]*:\n|^\S|\Z)', text)
    if not match:
        raise RuntimeError('Missing compose service')
    return match


def patch_compose(text):
    backend = block(text, 'backend')
    value = backend[0]
    if '    mem_limit:' not in value:
        value = value.replace('  backend:\n', '  backend:\n    mem_limit: 256m\n', 1)
    if '.teamspeak_secrets' not in value:
        if '    volumes:\n' not in value or '    env_file:\n' not in value:
            raise RuntimeError('Unexpected backend configuration')
        value = value.replace('    volumes:\n', '      - path: .teamspeak_secrets\n        required: false\n    volumes:\n', 1)
    text = text[:backend.start()] + value + text[backend.end():]
    frontend = block(text, 'frontend-nextjs')
    value = frontend[0]
    if '    mem_limit:' not in value:
        value = value.replace('  frontend-nextjs:\n', '  frontend-nextjs:\n    mem_limit: 256m\n', 1)
    text = text[:frontend.start()] + value + text[frontend.end():]
    teamspeak = block(text, 'teamspeak')
    value = teamspeak[0]
    if '127.0.0.1:10011:10011' not in value:
        value, count = re.subn(r'(?m)^\s*- ["\']10011:10011["\'](?:\s*#.*)?$', '      - "127.0.0.1:10011:10011"', value)
        if count != 1:
            raise RuntimeError('Unexpected query port mapping')
    if '.teamspeak_server_secrets' not in value:
        value = value.replace('    volumes:\n', '    env_file:\n      - path: .teamspeak_server_secrets\n        required: false\n    volumes:\n', 1)
    if '    networks:\n' not in value:
        value = value.rstrip() + '\n    networks:\n      - db2\n\n'
    elif '      - db2\n' not in value:
        raise RuntimeError('Unexpected TeamSpeak network')
    return text[:teamspeak.start()] + value + text[teamspeak.end():]


def validate_image(image, revision):
    data = json.loads(run('docker', 'image', 'inspect', image))[0]
    if data['Architecture'] != 'arm64' or data['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != revision:
        raise RuntimeError('Wrong deployment image')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True)
    parser.add_argument('--backend-image', required=True)
    parser.add_argument('--frontend-image', required=True)
    parser.add_argument('--website-only', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.revision):
        raise RuntimeError('Invalid revision')
    for name, image in [('backend', args.backend_image), ('frontend-nextjs', args.frontend_image)]:
        if image != 'ghcr.io/csbatagi/monorepo/' + name + ':teamspeak-' + args.revision:
            raise RuntimeError('Unexpected image')
        run('docker', 'pull', image, timeout=600)
        validate_image(image, args.revision)
    root = pathlib.Path.home()
    compose = root / 'docker-compose.yml'
    before = containers()
    previous = {name: service(before, name) for name in ['backend', 'frontend-nextjs', 'teamspeak']}
    postgres_id = service(before, 'postgres')['Id']
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ').lower()
    backup = root / ('teamspeak-web-backup-' + stamp)
    backup.mkdir(mode=0o700)
    for name in ['docker-compose.yml', '.teamspeak_secrets', '.teamspeak_server_secrets']:
        if (root / name).exists():
            shutil.copy2(root / name, backup / name)
            (backup / name).chmod(0o600)
    private_write(backup / 'images.json', json.dumps({name: value['Image'] for name, value in previous.items()}))
    rollback = backup / 'rollback.yml'
    private_write(rollback, 'services:\n' + ''.join('  ' + name + ':\n    image: ' + value['Image'] + '\n    pull_policy: never\n' for name, value in previous.items()))
    report({'backup': str(backup), 'revision': args.revision, 'phase': 'images verified; configuration/data backup'})
    patched = patch_compose(compose.read_text())
    overlay = root / 'docker-compose.teamspeak-test.yml'
    private_write(overlay, 'services:\n  backend:\n    image: ' + args.backend_image + '\n    pull_policy: never\n  frontend-nextjs:\n    image: ' + args.frontend_image + '\n    pull_policy: never\n  teamspeak:\n    image: ' + previous['teamspeak']['Image'] + '\n    pull_policy: never\n')
    compose_args = ['docker', 'compose', '-f', str(compose), '-f', str(overlay)]
    if args.website_only:
        if not (root / '.teamspeak_secrets').exists():
            raise RuntimeError('Website-only update requires existing private configuration')
        private_write(compose, patched)
        run(*compose_args, 'up', '-d', '--no-deps', 'backend', 'frontend-nextjs')
        current = containers()
        if service(current, 'postgres')['Id'] != postgres_id or service(current, 'teamspeak')['Id'] != previous['teamspeak']['Id']:
            raise RuntimeError('Website-only update restarted an unrelated service')
        info = json.loads(run('docker', 'info', '--format', '{{json .}}'))
        if info.get('MemoryLimit') is not True and info.get('MemTotal', 0) < 4 * 1024 ** 3:
            raise RuntimeError('Unsupported host memory budget')
        for name in ['backend', 'frontend-nextjs']:
            value = service(current, name)
            if not value['State']['Running'] or value['State']['OOMKilled'] or (info.get('MemoryLimit') is True and value['HostConfig']['Memory'] != 256 * 1024 * 1024):
                raise RuntimeError('Website service validation failed')
        report({'phase': 'website update deployed', 'revision': args.revision, 'teamspeak_unchanged': True, 'postgres_unchanged': True,
                'credential_rotated': False, 'memory_limits_enforced': info.get('MemoryLimit') is True, 'rollback': str(rollback)})
        return
    # TeamSpeak's SQLite files are copied while stopped. The original image and
    # all data are retained in a private backup; no unrelated DB is restarted.
    run('docker', 'stop', previous['teamspeak']['Id'])
    (backup / 'teamspeak-data').mkdir(mode=0o700)
    run('docker', 'cp', previous['teamspeak']['Id'] + ':/var/ts3server/.', str(backup / 'teamspeak-data'), timeout=300)
    private_write(compose, patched)
    bootstrap_path = root / '.teamspeak_server_secrets'
    if bootstrap_path.exists():
        env = dict(line.split('=', 1) for line in bootstrap_path.read_text().splitlines() if '=' in line)
        bootstrap_password = env.get('TS3SERVER_SERVERADMIN_PASSWORD')
    else:
        bootstrap_password = None
    if not bootstrap_password:
        bootstrap_password = secrets.token_hex(32)
        private_write(bootstrap_path, 'TS3SERVER_SERVERADMIN_PASSWORD=' + bootstrap_password + '\n')
    run(*compose_args, 'up', '-d', '--no-deps', 'backend')
    backend = service(containers(), 'backend')
    backend_ip = backend['NetworkSettings']['Networks']['db2']['IPAddress']
    whitelist = backup / 'query-ip-whitelist.txt'
    whitelist.write_text('127.0.0.1\n::1\n' + backend_ip + '\n')
    whitelist.chmod(0o644)  # Not a credential; TeamSpeak's container UID must read it.
    for filename in ['query_ip_allowlist.txt', 'query_ip_whitelist.txt']:
        run('docker', 'cp', str(whitelist), previous['teamspeak']['Id'] + ':/var/ts3server/' + filename)
    run(*compose_args, 'up', '-d', '--no-deps', 'teamspeak')
    teamspeak = service(containers(), 'teamspeak')
    deadline = time.monotonic() + 90
    while True:
        status = subprocess.run(['docker', 'exec', backend['Id'], 'node', '-e', 'const net=require("net");const c=net.connect(10011,"teamspeak",()=>{c.destroy();process.exit(0)});c.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),2000)'], capture_output=True, timeout=5)
        if status.returncode == 0:
            break
        if time.monotonic() >= deadline:
            raise RuntimeError('TeamSpeak did not become ready')
        time.sleep(2)
    report({'phase': 'private query port ready; provisioning restricted lobby and website account'})
    private_output = '/tmp/teamspeak-setup-' + stamp + '.private.json'
    bootstrap = {'host': 'voice.csbatagi.com', 'port': 9987, 'queryHost': 'teamspeak', 'queryPort': 10011,
                 'queryUser': 'serveradmin', 'queryPassword': bootstrap_password, 'serverId': 1}
    output = run('docker', 'exec', '-i', backend['Id'], 'node', '/app/setupTeamSpeak.js', '--apply', '--config-stdin', '--output-private=' + private_output,
                 input=json.dumps(bootstrap), timeout=60)
    public_result = json.loads(output)
    report({'phase': 'restricted provisioning and administrative denial checks passed'})
    private_config = backup / 'website-query.private.json'
    run('docker', 'cp', backend['Id'] + ':' + private_output, str(private_config))
    private_config.chmod(0o600)
    configured = json.loads(private_config.read_text())
    secret_file = root / '.teamspeak_secrets'
    values = {'TEAMSPEAK_HOST': 'voice.csbatagi.com', 'TEAMSPEAK_QUERY_HOST': 'teamspeak',
              'TEAMSPEAK_QUERY_USER': configured['queryUser'], 'TEAMSPEAK_QUERY_PASSWORD': configured['queryPassword'],
              'TEAMSPEAK_MEMBER_GROUP_ID': configured['groupId'], 'TEAMSPEAK_LOBBY_CHANNEL_ID': configured['lobbyId'],
              'TEAMSPEAK_MEMBER_CHANNEL_ID': configured['memberChannelId']}
    if any(not re.fullmatch(r'[A-Za-z0-9+/_=.-]+', str(value)) for value in values.values()):
        raise RuntimeError('Unexpected private configuration format')
    private_write(secret_file, ''.join(name + '=' + str(value) + '\n' for name, value in values.items()))
    report({'phase': 'private website credential stored'})
    run(*compose_args, 'up', '-d', '--no-deps', '--force-recreate', 'backend')
    backend = service(containers(), 'backend')
    report({'phase': 'backend private credential loaded'})
    final_ip = backend['NetworkSettings']['Networks']['db2']['IPAddress']
    if final_ip != backend_ip:
        whitelist.write_text('127.0.0.1\n::1\n' + final_ip + '\n')
        for filename in ['query_ip_allowlist.txt', 'query_ip_whitelist.txt']:
            run('docker', 'cp', str(whitelist), teamspeak['Id'] + ':/var/ts3server/' + filename)
        run(*compose_args, 'restart', 'teamspeak')
    run(*compose_args, 'up', '-d', '--no-deps', 'frontend-nextjs')
    report({'phase': 'frontend image started'})
    current = containers()
    memory_info = json.loads(run('docker', 'info', '--format', '{{json .}}'))
    memory_supported = memory_info.get('MemoryLimit') is True
    if not memory_supported and memory_info.get('MemTotal', 0) < 4 * 1024 ** 3:
        raise RuntimeError('Unsupported memory limits require a separately checked host budget')
    if service(current, 'postgres')['Id'] != postgres_id:
        raise RuntimeError('Unexpected PostgreSQL restart')
    for name in ['backend', 'frontend-nextjs']:
        value = service(current, name)
        if (memory_supported and value['HostConfig']['Memory'] != 256 * 1024 * 1024) or not value['State']['Running'] or value['State']['OOMKilled']:
            raise RuntimeError('Website service validation failed')
    bound = service(current, 'teamspeak')['HostConfig']['PortBindings'].get('10011/tcp', [])
    if not bound or any(item['HostIp'] != '127.0.0.1' for item in bound):
        raise RuntimeError('Query port is not restricted')
    report({'phase': 'deployed', 'revision': args.revision, 'query_port_private': True, 'website_memory_limits_requested': '256 MiB each', 'memory_limits_enforced': memory_supported,
            'postgres_unchanged': True, 'private_credentials_mode': oct(secret_file.stat().st_mode & 0o777),
            'member_group': public_result['groupId'], 'lobby': public_result['lobbyId'], 'voice_channel': public_result['memberChannelId'],
            'rollback': str(rollback)})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        report({'deployment_failed': type(error).__name__, 'credentials_logged': False,
                'recovery': 'Use the private teamspeak-web-backup directory; existing images/data were retained.'})
        raise SystemExit(1)
