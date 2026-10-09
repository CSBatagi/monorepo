#!/usr/bin/env python3
import os
import pathlib

game = pathlib.Path('/home/steam/cs2/game')
binary = str(game / 'bin/linuxsteamrt64/cs2')
os.environ['LD_LIBRARY_PATH'] = f'{game}/bin/linuxsteamrt64:{game}/csgo/bin/linuxsteamrt64'
args = [binary, '-dedicated', '-console', '-usercon', '-port', '27015', '-maxplayers', '24',
        '+game_type', '0', '+game_mode', '1', '+exec', 'csbatagi_secrets.cfg',
        '+tv_enable', '1', '+tv_enable_dynamic', '0', '+tv_delay', '0',
        '+exec', 'server.cfg', '+exec', 'csbatagi_startup_gate.cfg', '+map', 'de_dust2']
os.execv(binary, args)
