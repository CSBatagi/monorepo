#!/usr/bin/env python3
import os
import pathlib

game = pathlib.Path('/home/steam/cs2/game')
ROOT = pathlib.Path('/home/steam/csbatagi-updates')


def relay_enabled():
    try:
        return (ROOT / 'sdr-enabled').read_text().strip() == '1'
    except OSError:
        return False


def arguments(binary, relay):
    # The Steam relay only reaches anonymous [A:...] game-server identities. The token
    # stays in its own file for the direct-only mode (sdr-enabled 0 or absent).
    token = [] if relay else ['+exec', 'csbatagi_steam_token.cfg']
    return [binary, '-dedicated', '-console', '-usercon', '-port', '27015', '-maxplayers', '24',
            '+game_type', '0', '+game_mode', '1', '+exec', 'csbatagi_secrets.cfg', *token,
            '+tv_enable', '1', '+tv_enable_dynamic', '0', '+tv_delay', '0',
            '+exec', 'server.cfg', '+exec', 'csbatagi_startup_gate.cfg', '+map', 'de_dust2']


if __name__ == '__main__':
    binary = str(game / 'bin/linuxsteamrt64/cs2')
    os.environ['LD_LIBRARY_PATH'] = f'{game}/bin/linuxsteamrt64:{game}/csgo/bin/linuxsteamrt64'
    os.execv(binary, arguments(binary, relay_enabled()))
