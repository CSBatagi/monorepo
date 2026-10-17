#!/usr/bin/env python3
"""Preserve Valve KeyValues while enabling SDR; report only a verified Steam address."""
import os
import pathlib
import re

GAME = pathlib.Path('/home/steam/cs2/game/csgo')
ROOT = pathlib.Path('/home/steam/csbatagi-updates')
HERE = pathlib.Path(__file__).resolve().parent
BOOT = pathlib.Path('/proc/sys/kernel/random/boot_id')
READY = pathlib.Path('/run/csbatagi/ready')
TOKEN = re.compile(r'\s+|//[^\n]*|/\*[\s\S]*?\*/|"(?:\\.|[^"\\])*"|[{}]|[^\s{}"]+')
IDENTITY = re.compile(r'^\s*(?i:steamid)\s*:\s*\[([AG]):1:([1-9]\d{0,9})(?::(\d{1,7}))?\](?=\s|$)', re.M)
SECRETS_CONFIG = 'csbatagi_secrets.cfg'
TOKEN_CONFIG = 'csbatagi_steam_token.cfg'
TOKEN_LINE = re.compile(r'^[ \t]*sv_setsteamaccount\b[^\n]*(?:\n|$)', re.M)


def parse(text):
    tokens = []
    position = 0
    for match in TOKEN.finditer(text):
        if match.start() != position:
            raise RuntimeError('sdr_gameinfo_syntax')
        position = match.end()
        value = match.group()
        if value.isspace() or value.startswith(('//', '/*')):
            continue
        tokens.append((value.strip('"'), match.start(), match.end(), value in ['{', '}']))
    if position != len(text):
        raise RuntimeError('sdr_gameinfo_syntax')
    index = 0

    def block(nested=False):
        nonlocal index
        result = []
        while index < len(tokens):
            key = tokens[index]; index += 1
            if key[0] == '}' and key[3]:
                if not nested:
                    raise RuntimeError('sdr_gameinfo_syntax')
                return result, key[1]
            if (key[0] == '{' and key[3]) or index >= len(tokens):
                raise RuntimeError('sdr_gameinfo_syntax')
            value = tokens[index]; index += 1
            if value[0] == '{' and value[3]:
                children, end = block(True)
                result.append({'key': key[0], 'children': children, 'end': end})
            elif value[0] == '}' and value[3]:
                raise RuntimeError('sdr_gameinfo_syntax')
            else:
                result.append({'key': key[0], 'value': value[0], 'start': value[1], 'end': value[2]})
        if nested:
            raise RuntimeError('sdr_gameinfo_syntax')
        return result, len(text)

    return block()[0]


def child(nodes, name):
    found = [node for node in nodes if node['key'].lower() == name.lower()]
    if len(found) > 1:
        raise RuntimeError('sdr_gameinfo_duplicate')
    return found[0] if found else None


def configured(text, enabled):
    for section, key, value in [('ConVars', 'net_p2p_listen_dedicated', '1' if enabled else '0'),
                                ('NetworkSystem', 'CreateListenSocketP2P', '2' if enabled else '0')]:
        root = child(parse(text), 'GameInfo')
        if not root or 'children' not in root:
            raise RuntimeError('sdr_gameinfo_root')
        filesystem = child(root['children'], 'FileSystem')
        app = child(filesystem.get('children', []), 'SteamAppId') if filesystem else None
        if not app or app.get('value') != '730':
            raise RuntimeError('sdr_gameinfo_appid')
        target = child(root['children'], section)
        if not target:
            insert = f'\n\t{section}\n\t{{\n\t\t"{key}" "{value}"\n\t}}\n'
            text = text[:root['end']] + insert + text[root['end']:]
        elif 'children' not in target:
            raise RuntimeError('sdr_gameinfo_section')
        else:
            prop = child(target['children'], key)
            if prop and 'value' not in prop:
                raise RuntimeError('sdr_gameinfo_property')
            if prop:
                text = text[:prop['start']] + f'"{value}"' + text[prop['end']:]
            else:
                text = text[:target['end']] + f'\n\t\t"{key}" "{value}"\n\t' + text[target['end']:]
    return text


def enabled():
    try:
        return (ROOT / 'sdr-enabled').read_text().strip() == '1'
    except OSError:
        return False


def gate_config(text):
    # server.cfg runs again on every map; always apply the root-managed gate last.
    hook = 'exec csbatagi_startup_gate.cfg'
    lines = [line for line in text.splitlines() if line.strip() != hook]
    return '\n'.join(lines).rstrip() + '\n' + hook + '\n'


def prepare():
    flag = ROOT / 'sdr-enabled'
    if not flag.exists():
        return  # An unconfigured installation keeps Valve defaults.
    path = GAME / 'gameinfo_branchspecific.gi'
    before = path.read_text()
    after = configured(before, enabled())
    if after != before:
        partial = path.with_name(path.name + '.sdr')
        partial.write_text(after)
        partial.chmod(path.stat().st_mode & 0o777)
        partial.replace(path)


def relay_address(console):
    # CS2 clients dial a token login's [G:1:account] as instance 1, but the server is
    # instance 0, so only anonymous [A:1:account:instance] identities are reachable.
    match = IDENTITY.search(console)
    if not match or match[1] != 'A' or match[3] is None:
        return None
    return f'[A:1:{match[2]}:{match[3]}]'


def validate(command):
    if not enabled():
        return None
    output = command('net_p2p_listen_dedicated')
    if not re.search(r'net_p2p_listen_dedicated"?\s*=\s*"?(?:1|true)\b', output, re.I):
        raise RuntimeError('sdr_listener_not_enabled')
    console = command('status')
    identity = IDENTITY.search(console)
    if identity and identity[1] == 'G':
        raise RuntimeError('sdr_token_login_unreachable')
    address = relay_address(console)
    if not address:
        raise RuntimeError('sdr_steam_identity_unavailable')
    return {'address': address}


def replace_private(path, text, like):
    partial = path.with_name(path.name + '.tmp')
    with os.fdopen(os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        stream.write(text)
    stat = like.stat()
    partial.chmod(stat.st_mode & 0o777)
    if hasattr(os, 'chown'):
        os.chown(partial, stat.st_uid, stat.st_gid)
    partial.replace(path)


def separate_token():
    """Keep the Steam game-server token for rollback, outside the club secrets.

    launch.py executes the token file only when the relay is disabled. Values are
    never printed. Returns whether a token line was moved."""
    secrets_path = GAME / 'cfg' / SECRETS_CONFIG
    token_path = GAME / 'cfg' / TOKEN_CONFIG
    text = secrets_path.read_text()
    lines = TOKEN_LINE.findall(text)
    if not lines:
        return False
    if len(lines) != 1:
        raise RuntimeError('sdr_token_ambiguous')
    token = lines[0].rstrip('\r\n') + '\n'
    if token_path.exists() and token_path.read_text() != token:
        raise RuntimeError('sdr_token_conflict')
    replace_private(token_path, token, secrets_path)  # First, so an interruption loses nothing.
    replace_private(secrets_path, TOKEN_LINE.sub('', text), secrets_path)
    return True


def report(command):
    # Only the root gate opener can mark this boot as accepting members.
    try:
        if READY.read_text().strip() != BOOT.read_text().strip():
            return None
        return validate(command)
    except (OSError, RuntimeError):
        return None


if __name__ == '__main__':
    prepare()
