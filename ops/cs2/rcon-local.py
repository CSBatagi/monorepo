#!/usr/bin/env python3
"""Local admin console; reads the RCON secret without printing it."""
import pathlib
import re
import socket
import struct
import sys


def command(text):
    config = pathlib.Path('/home/steam/cs2/game/csgo/cfg/csbatagi_secrets.cfg').read_text()
    password = re.search(r'^rcon_password\s+"([^"\n]+)"', config, re.M).group(1)
    def packet(identifier, kind, body):
        data = struct.pack('<ii', identifier, kind) + body.encode() + b'\0\0'
        return struct.pack('<i', len(data)) + data
    with socket.create_connection(('10.156.0.11', 27015), timeout=5) as sock:
        def read_exact(size):
            data = b''
            while len(data) < size:
                chunk = sock.recv(size - len(data))
                if not chunk:
                    raise ConnectionError('RCON closed')
                data += chunk
            return data
        def receive():
            size = struct.unpack('<i', read_exact(4))[0]
            if not 10 <= size <= 4 * 1024 * 1024:
                raise ValueError('Invalid RCON packet')
            data = read_exact(size)
            return (*struct.unpack('<ii', data[:8]), data[8:-2].decode(errors='replace'))
        sock.sendall(packet(1, 3, password))
        while True:
            identifier, kind, body = receive()
            if identifier == -1:
                raise PermissionError('RCON authentication failed')
            if kind == 2:
                break
        sock.sendall(packet(2, 2, text))
        sock.settimeout(1)
        output = []
        try:
            while True:
                identifier, kind, body = receive()
                output.append(body)
        except socket.timeout:
            return ''.join(output)


if __name__ == '__main__':
    print(command(' '.join(sys.argv[1:])))
