#!/usr/bin/env python3
"""Repair the exact identity-write permission without rotating credentials.

The write probe creates/removes one unique non-authorizing custom property on a
connected native client. It never assigns a group, reads a proof, or prints any
member identifiers, credentials, custom properties, query replies or raw logs.
"""
import json
import pathlib
import socket
import importlib.util
import uuid
spec = importlib.util.spec_from_file_location('teamspeak_inspect', pathlib.Path(__file__).with_name('inspect-production.py'))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
query_escape, query_rows = helpers.query_escape, helpers.query_rows
phase = 'private configuration'


def main():
    global phase
    root = pathlib.Path.home()
    def env_file(name):
        return dict(line.split('=', 1) for line in (root / name).read_text().splitlines() if '=' in line)
    admin = env_file('.teamspeak_server_secrets')['TS3SERVER_SERVERADMIN_PASSWORD']
    private = env_file('.teamspeak_secrets')
    group_id = private['TEAMSPEAK_MEMBER_GROUP_ID']
    assert group_id.isdigit() and private['TEAMSPEAK_QUERY_USER'] != 'serveradmin'
    with socket.create_connection(('127.0.0.1', 10011), timeout=10) as connection:
        stream = connection.makefile('r', newline='\n')
        def command(name, **params):
            connection.sendall((name + ''.join(' ' + key + '=' + query_escape(value) for key, value in params.items()) + '\n').encode())
            rows = []
            while True:
                line = stream.readline()
                if not line:
                    raise RuntimeError('Query disconnected')
                line = line.strip('\r\n')
                if not line or line == 'TS3' or line.startswith(('Welcome', 'notify')):
                    continue
                if line.startswith('error '):
                    status = query_rows(line[6:])[0]
                    if status['id'] not in ['0', '1281']:
                        error = RuntimeError('Query rejected')
                        error.code = status['id']
                        error.permission = status.get('failed_permid')
                        error.command = name.split(' ')[0]
                        raise error
                    return query_rows('|'.join(rows))
                rows.append(line)
        def login(user, password):
            command('login', client_login_name=user, client_login_password=password)
            command('use', sid=1)
        phase = 'bootstrap login'
        login('serveradmin', admin)
        phase = 'query group lookup'
        groups = command('servergrouplist')
        group = next(row for row in groups if row['name'] == 'CS Batagi Website Query' and row['type'] == '2')
        phase = 'identity write permission lookup'
        permission = next(row for row in command('permissionlist') if row['permname'] == 'b_client_modify_dbproperties')
        phase = 'identity write permission update'
        command('servergroupaddperm', sgid=group['sgid'], permid=permission['permid'], permvalue=1, permnegated=0, permskip=0)
        print(json.dumps({'identity_write_permission_repaired': True, 'credential_rotated': False}), flush=True)
        login(private['TEAMSPEAK_QUERY_USER'], private['TEAMSPEAK_QUERY_PASSWORD'])
        for name, params in [('serveredit', {'virtualserver_name': 'CS Batağı'}),
                             ('servergroupaddperm', {'sgid': group_id, 'permsid': 'i_client_talk_power', 'permvalue': 50, 'permnegated': 0, 'permskip': 0}),
                             ('tokenlist', {})]:
            try:
                command(name, **params)
            except RuntimeError as error:
                if getattr(error, 'code', None) != '2568':
                    raise
            else:
                raise RuntimeError('Administrative boundary failed')
        print(json.dumps({'administrative_denial_checks_passed': 3}), flush=True)
        clients = command('clientlist -uid -groups')
        native = next((row for row in clients if row.get('client_type') == '0'), None)
        if native:
            ident = 'csbatagi_probe_' + uuid.uuid4().hex
            value = uuid.uuid4().hex
            try:
                command('customset', cldbid=native['client_database_id'], ident=ident, value=value)
                assert any(row.get('ident') == ident and row.get('value') == value for row in command('custominfo', cldbid=native['client_database_id']))
                print(json.dumps({'native_identity_write_readback_passed': True, 'member_group_assigned': False}), flush=True)
            finally:
                # Cleanup the unique probe even if a disconnect or readback fails.
                login('serveradmin', admin)
                command('customdelete', cldbid=native['client_database_id'], ident=ident)
                print(json.dumps({'temporary_probe_removed': True}), flush=True)
        else:
            print(json.dumps({'native_identity_write_readback_passed': None, 'reason': 'no connected native client'}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'repair_failed': True, 'phase': phase, 'error_type': type(error).__name__, 'query_code': getattr(error, 'code', None), 'permission_id': getattr(error, 'permission', None), 'command': getattr(error, 'command', None), 'credentials_logged': False}))
        raise SystemExit(1)
