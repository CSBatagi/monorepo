#!/usr/bin/env python3
"""Analyze finished match demos into the club database with the CS Demo Manager CLI.

Runs on the game VM as the steam user. The backend decides which demos to analyze
(finished recordings of website matches, or admin requests); this worker reports what
exists locally, runs the CLI only while no match is live, and reports the outcome.
It never deletes demo files.

Demos members uploaded from other servers (xplay.gg, FACEIT...) exist only in the bucket. Their
jobs carry a signed download link, the match time (CS Demo Manager dates a match by the file's
mtime) and the `--source` to analyze with; xplay.gg demos usually need "matchzy".
"""
import datetime
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request

GAME = pathlib.Path(os.environ.get('CS2_GAME', '/home/steam/cs2/game/csgo'))
STATE = GAME / 'csbatagi-state'
DEMOS = GAME / 'demos'
# Bucket copies for re-analysis live outside demos/ so the archive worker never re-uploads them.
RESTORED = STATE / 'analysis-downloads'
BACKEND = os.environ.get('CSBATAGI_BACKEND', 'https://csbatagi.com/backend').rstrip('/')
TOKEN_FILE = pathlib.Path(os.environ.get('CSBATAGI_TOKEN_FILE', str(GAME / 'cfg/csbatagi-web-token')))
CSDM = os.environ.get('CSDM_CLI', '/usr/local/bin/csdm')
BUCKET = os.environ.get('DEMO_BUCKET', 'csbatagi-demos')
INTERVAL = int(os.environ.get('ANALYZER_INTERVAL', '60'))
ANALYZE_TIMEOUT = int(os.environ.get('ANALYZER_TIMEOUT', '3600'))
# `csdm analyze --source` values of CS Demo Manager 3.20.1; "auto" lets the CLI detect the source.
SOURCES = {
    'matchzy', 'valve', 'faceit', 'esea', 'esl', 'ebot', 'esplay', 'esportal', 'esportligaen', 'fastcup',
    '5eplay', 'gamersclub', 'challengermode', 'perfectworld', 'popflash', 'pracc', 'renown',
}
SAFE_NAME = re.compile(r'^[\w.-]{1,200}\.dem$')
DEMO_STAMP = b'PBDEMS2\x00'
SIGNED_HOST = 'https://storage.googleapis.com/'
UPLOAD_PREFIX = 'uploads/'


def api(route, payload):
    request = urllib.request.Request(
        BACKEND + route, data=json.dumps(payload).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + TOKEN_FILE.read_text().strip(), 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def game_report():
    """The plugin's status.json, rewritten every few seconds. A stale file means CS2 is not running.

    The backend uses this to tell whether anyone is on the server before it closes an idle VM.
    """
    status_file = STATE / 'status.json'
    try:
        if time.time() - status_file.stat().st_mtime > 120:
            return {'running': False}
        status = json.loads(status_file.read_text())
    except (OSError, ValueError):
        return {'running': False}
    return {
        'running': True, 'humans': int(status.get('humans') or 0), 'live': bool(status.get('live')),
        'preparing': bool(status.get('preparing')), 'recording': bool(status.get('recording')),
    }


def server_busy(report=None):
    """True while a match is being prepared, played or recorded."""
    report = report or game_report()
    return bool(report.get('live') or report.get('preparing') or report.get('recording'))


def upload_states():
    states = {}
    database = STATE / 'uploads.sqlite'
    if not database.exists():
        return states
    try:
        connection = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
        for name, state, object_name in connection.execute('SELECT name, state, object FROM uploads'):
            states[name] = (state, object_name)
        connection.close()
    except sqlite3.Error:
        pass
    return states


def inventory():
    uploads = upload_states()
    demos = []
    for path in sorted(DEMOS.glob('*.dem')):
        recording_state, match_id = 'recording', None
        marker = path.with_suffix('.dem.closed.json')
        if marker.exists():
            try:
                data = json.loads(marker.read_text())
                recording_state = str(data.get('state', 'unknown'))
                match_id = data.get('matchId')
            except ValueError:
                recording_state = 'unknown'
        upload_state, object_name = uploads.get(path.name, ('pending', None))
        demos.append({
            'name': path.name, 'size': path.stat().st_size, 'recordingState': recording_state,
            'matchId': match_id if isinstance(match_id, int) else None,
            'archiveState': upload_state, 'objectName': object_name,
        })
    return demos


def demo_name(job):
    name = str(job.get('name', ''))
    if not SAFE_NAME.match(name) or '..' in name:
        raise RuntimeError('unsafe demo name')
    return name


def fetch_signed(job, target):
    """Download an uploaded demo through its signed link, then check size and CS2 stamp before use."""
    url = job['downloadUrl']
    if not url.startswith(SIGNED_HOST):
        raise RuntimeError('unexpected download host')
    partial = target.with_name(target.name + '.part')
    try:
        with urllib.request.urlopen(url, timeout=60) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output, 8 * 1024 * 1024)
        size = partial.stat().st_size
        if job.get('size') and size != job['size']:
            raise RuntimeError(f"downloaded {size} of {job['size']} bytes")
        with partial.open('rb') as demo:
            if demo.read(len(DEMO_STAMP)) != DEMO_STAMP:
                raise RuntimeError('downloaded file is not a CS2 demo')
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)


def stamp_match_time(path, job):
    """CS Demo Manager takes the match date from the file's mtime; uploads carry the real match time."""
    recorded = job.get('recordedAt')
    if not recorded:
        return
    moment = datetime.datetime.fromisoformat(recorded.replace('Z', '+00:00')).timestamp()
    os.utime(path, (moment, moment))


def locate(job):
    name = demo_name(job)
    local = DEMOS / name
    if local.exists():
        return local
    if not job.get('objectName') and not job.get('downloadUrl'):
        return None
    RESTORED.mkdir(exist_ok=True)
    target = RESTORED / name
    if not target.exists() and job.get('downloadUrl'):
        fetch_signed(job, target)
    elif not target.exists() and str(job.get('objectName', '')).startswith(UPLOAD_PREFIX):
        # This VM's account cannot read uploads/, so gcloud would only fail with a permission error.
        raise RuntimeError('the backend sent no signed download link for this uploaded demo '
                           '(see "[demos] worker link failed" in the backend log)')
    elif not target.exists():
        result = subprocess.run(
            ['/snap/bin/gcloud', 'storage', 'cp', f"gs://{BUCKET}/{job['objectName']}", str(target), '--quiet'],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=1200,
            env={**os.environ, 'CLOUDSDK_CONFIG': '/home/steam/csbatagi-gcloud'})
        if result.returncode != 0:
            target.unlink(missing_ok=True)
            raise RuntimeError('archive download failed: ' + result.stderr.decode(errors='replace')[-300:])
    return target


def analyze(job):
    source = job.get('source') or 'matchzy'
    if source != 'auto' and source not in SOURCES:
        raise RuntimeError(f'unsupported analysis source {source!r}')
    path = locate(job)
    if path is None:
        raise RuntimeError('demo is neither on the game server nor in the archive')
    stamp_match_time(path, job)
    command = ['nice', '-n', '15', 'ionice', '-c', '3', CSDM, 'analyze', str(path)]
    if source != 'auto':
        command += ['--source', source]
    if job.get('force'):
        command.append('--force')
    result = subprocess.run(command, capture_output=True, text=True, timeout=ANALYZE_TIMEOUT,
                            env={**os.environ, 'HOME': os.environ.get('HOME', '/home/steam')})
    output = (result.stdout + '\n' + result.stderr).strip()
    if result.returncode != 0:
        raise RuntimeError(f'csdm exited {result.returncode}: {output[-500:]}')
    return output[-500:]


def run_once():
    game = game_report()
    busy = server_busy(game)
    response = api('/demo-analysis/sync', {'busy': busy, 'demos': inventory(), 'game': game})
    for job in [] if busy else response.get('jobs', []):
        if server_busy():
            return
        api('/demo-analysis/result', {'name': job['name'], 'state': 'analyzing'})
        try:
            log = analyze(job)
            # The backend checks the CS Demo Manager tables before it believes this report.
            api('/demo-analysis/result', {'name': job['name'], 'state': 'analyzed', 'log': log})
            print('Analyzed:', job['name'], flush=True)
        except Exception as error:  # noqa: BLE001 - every failure must be reported, not crash the loop
            api('/demo-analysis/result', {'name': job['name'], 'state': 'failed', 'error': f'{type(error).__name__}: {error}'[-800:]})
            print('Analysis failed:', job['name'], type(error).__name__, flush=True)


def main():
    STATE.mkdir(exist_ok=True)
    while True:
        try:
            run_once()
        except urllib.error.HTTPError as error:
            print('Backend rejected request:', error.code, flush=True)
        except Exception as error:  # noqa: BLE001
            print('Worker error:', type(error).__name__, str(error)[:200], flush=True)
        time.sleep(INTERVAL)


if __name__ == '__main__':
    main()
