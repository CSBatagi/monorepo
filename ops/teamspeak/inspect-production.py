#!/usr/bin/env python3
"""Read-only production audit. Never print Docker Env, raw logs or query credentials."""
import json
import pathlib
import re
import socket
import subprocess


def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def report(value):
    print(json.dumps(value, ensure_ascii=True))


def query_escape(value):
    return ''.join({'\\': '\\\\', '/': '\\/', ' ': '\\s', '|': '\\p', '\n': '\\n', '\r': '\\r'}.get(char, char) for char in str(value))


def query_rows(value):
    escapes = {'\\': '\\', '/': '/', 's': ' ', 'p': '|', 'n': '\n', 'r': '\r', 't': '\t'}
    return [{key: re.sub(r'\\([\\/spnrt])', lambda match: escapes[match[1]], raw) for key, raw in
             (field.split('=', 1) for field in row.split(' ') if '=' in field)} for row in value.split('|') if row]


def main():
    report({'host': {'architecture': run('uname', '-m').strip(), 'memory_kib': int(re.search(r'MemTotal:\s+(\d+)', pathlib.Path('/proc/meminfo').read_text())[1])}})
    docker_info = json.loads(run('docker', 'info', '--format', '{{json .}}'))
    report({'docker_memory_capability': {key: docker_info.get(key) for key in ['MemoryLimit', 'SwapLimit', 'CgroupVersion', 'MemTotal']}})
    ids = run('docker', 'ps', '-aq').split()
    containers = json.loads(run('docker', 'inspect', *ids)) if ids else []
    for item in containers:
        report({'container': item['Name'], 'image': item['Config']['Image'], 'running': item['State']['Running'],
                'oom': item['State']['OOMKilled'], 'memory_limit': item['HostConfig']['Memory'],
                'ports': item['HostConfig']['PortBindings'], 'networks': list(item['NetworkSettings']['Networks']),
                'mounts': [{key: mount.get(key) for key in ['Type', 'Source', 'Destination']} for mount in item['Mounts']]})
    root = pathlib.Path.home()
    report({'compose_files': [file.name for file in root.glob('*compose*.yml')]})
    effective = json.loads(run('docker', 'compose', '-f', str(root / 'docker-compose.yml'), '-f', str(root / 'docker-compose.teamspeak-test.yml'), 'config', '--format', 'json'))
    report({'effective_web_limits': {name: {'mem_limit': effective['services'][name].get('mem_limit'), 'deploy': effective['services'][name].get('deploy')} for name in ['backend', 'frontend-nextjs']}})
    report({'private_files_present': {name: (root / name).exists() for name in ['.teamspeak_secrets', '.teamspeak_server_secrets']}})
    for folder in sorted(root.glob('teamspeak-web-backup-*'))[-1:]:
        report({'latest_backup': folder.name, 'private_provisioning_result_exists': (folder / 'website-query.private.json').exists()})
    ts = next((item for item in containers if item['Name'] == '/teamspeak-server'), None)
    if not ts:
        report({'teamspeak': 'not found'}); return
    env = dict(value.split('=', 1) for value in ts['Config']['Env'] if '=' in value)
    password = env.get('TS3SERVER_SERVERADMIN_PASSWORD')
    if not password:
        captured = subprocess.run(['docker', 'logs', ts['Id']], capture_output=True, text=True, check=True)
        logs = captured.stdout + captured.stderr
        match = re.search(r'loginname=\s*"serveradmin",\s*password=\s*"([^"\r\n]+)"', logs)
        password = match[1] if match else None
    if not password:
        report({'teamspeak_query': 'bootstrap credential not available in environment/startup stdout'}); return
    bindings = ts['NetworkSettings']['Ports'].get('10011/tcp') or []
    port = int(bindings[0]['HostPort']) if bindings else 10011
    with socket.create_connection(('127.0.0.1', port), timeout=10) as connection:
        stream = connection.makefile('r', newline='\n')

        def command(name, **params):
            text = name + ''.join(' ' + key + '=' + query_escape(value) for key, value in params.items())
            connection.sendall((text + '\n').encode())
            rows = []
            while True:
                raw = stream.readline()
                if not raw:
                    raise RuntimeError('Query disconnected')
                line = raw.strip('\r\n')
                if not line or line == 'TS3' or line.startswith('Welcome'): continue
                if line.startswith('error '):
                    status = query_rows(line[6:])[0]
                    if status.get('id') not in ['0', '1281']:
                        raise RuntimeError('Query command unavailable: ' + name + ', code ' + status.get('id', '?'))
                    return query_rows('|'.join(rows))
                rows.append(line)

        command('login', client_login_name='serveradmin', client_login_password=password)
        command('use', sid=1)
        server = command('serverinfo')[0]
        report({'teamspeak_server': {key: server.get(key) for key in ['virtualserver_name', 'virtualserver_version', 'virtualserver_flag_password', 'virtualserver_default_channel', 'virtualserver_default_server_group', 'virtualserver_clientsonline', 'virtualserver_maxclients']}})
        report({'teamspeak_groups': command('servergrouplist')})
        report({'teamspeak_channels': command('channellist')})
        report({'identity_permission_names': [row for row in command('permissionlist') if row.get('permid') == '35' or 'custom' in row.get('permname', '')]})
        for name in ['queryloginadd', 'queryloginlist', 'customset', 'servergroupcopy']:
            try:
                command('help ' + name)
                report({'command': name, 'available': True})
            except RuntimeError:
                report({'command': name, 'available': False})
    report({'teamspeak_query': 'read-only audit completed; bootstrap credential stayed on host'})


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not include exception values: underlying tools may carry sensitive output.
        report({'audit_failed': type(error).__name__})
        raise SystemExit(1)
