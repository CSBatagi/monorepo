#!/usr/bin/env python3
"""Durable, local-first archive worker. Never removes local demos."""
import base64
import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
import time
import urllib.parse
import urllib.request

GAME = pathlib.Path(os.environ.get('CS2_GAME', '/home/steam/cs2/game/csgo'))
STATE = GAME / 'csbatagi-state'
BUCKET = os.environ.get('DEMO_BUCKET', 'csbatagi-demos')


def token():
    request = urllib.request.Request(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        headers={'Metadata-Flavor': 'Google'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)['access_token']


def remote_md5(name):
    url = f'https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{urllib.parse.quote(name, safe="")}'
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token()})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response).get('md5Hash')


def opened_files():
    opened = set()
    for process in pathlib.Path('/proc').glob('[0-9]*'):
        try:
            for fd in (process / 'fd').iterdir():
                try:
                    opened.add(os.readlink(fd))
                except OSError:
                    pass
        except OSError:
            pass
    return opened


def run_once(db):
    files = list((GAME / 'demos').glob('*.dem'))
    opened = opened_files()
    for path in files:
        size = path.stat().st_size
        row = db.execute('SELECT state,size FROM uploads WHERE name=?', (path.name,)).fetchone()
        if row and row == ('verified', size):
            continue
        if str(path) in opened or time.time() - path.stat().st_mtime < 30:
            continue
        marker = path.with_suffix('.dem.closed.json')
        if not marker.exists():
            # Preserve crash leftovers as interrupted evidence, never as a complete match.
            if time.time() - path.stat().st_mtime < 300:
                continue
            marker.write_text(json.dumps({'state': 'interrupted', 'reason': 'missing-close-marker'}))
        db.execute('INSERT INTO uploads(name,state,size) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET state=excluded.state,size=excluded.size', (path.name, 'pending', size))
        db.commit()
        try:
            digest = hashlib.md5()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
                    digest.update(block)
            checksum = base64.b64encode(digest.digest()).decode()
            object_name = 'resurrection/' + path.name
            # Create-only makes retries safe: after uncertain success, verify the existing object.
            result = subprocess.run([
                '/snap/bin/gcloud', 'storage', 'cp', str(path), f'gs://{BUCKET}/{object_name}',
                '--if-generation-match=0', '--storage-class=STANDARD', '--quiet'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1200,
                env={**os.environ, 'CLOUDSDK_CONFIG': '/home/steam/csbatagi-gcloud'})
            if remote_md5(object_name) != checksum:
                raise RuntimeError('remote checksum mismatch')
            db.execute('UPDATE uploads SET state=?,md5=?,object=?,error=NULL WHERE name=?', ('verified', checksum, object_name, path.name))
            print('Verified archive:', path.name, size, flush=True)
        except Exception as error:
            db.execute('UPDATE uploads SET state=?,error=? WHERE name=?', ('pending', type(error).__name__, path.name))
            print('Archive pending:', path.name, type(error).__name__, flush=True)
        db.commit()
    rows = [dict(zip(('name', 'state', 'size', 'object', 'error'), row)) for row in db.execute('SELECT name,state,size,object,error FROM uploads ORDER BY rowid DESC')]
    verified = {row['name'] for row in rows if row['state'] == 'verified'}
    status = {'updatedAt': time.time(), 'pending': sum(p.name not in verified for p in files), 'demos': rows[:100]}
    tmp = STATE / 'uploads.json.tmp'
    tmp.write_text(json.dumps(status))
    tmp.replace(STATE / 'uploads.json')


def main():
    STATE.mkdir(exist_ok=True)
    db = sqlite3.connect(STATE / 'uploads.sqlite')
    db.execute('CREATE TABLE IF NOT EXISTS uploads(name TEXT PRIMARY KEY,state TEXT NOT NULL,size INTEGER NOT NULL,md5 TEXT,object TEXT,error TEXT)')
    while True:
        try:
            run_once(db)
        except Exception as error:
            print('Worker error:', type(error).__name__, flush=True)
        time.sleep(30)


if __name__ == '__main__':
    main()
