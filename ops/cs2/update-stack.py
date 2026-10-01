#!/usr/bin/env python3
"""Update the stopped game and custom plugins; verify before opening public UDP.

Runs as steam. Only gate.sh and systemd installation require root. No secrets in
packages, manifests or status reports. All subprocesses have bounded lifetimes.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid
import zipfile

HOME = pathlib.Path('/home/steam')
GAME = HOME / 'cs2/game/csgo'
ROOT = HOME / 'csbatagi-updates'
HERE = pathlib.Path(__file__).resolve().parent
STATE = ROOT / 'status.json'
BOOT = pathlib.Path('/proc/sys/kernel/random/boot_id')
MIN_FREE = 4 * 1024**3
REPOS = {'css': 'roflmuffin/CounterStrikeSharp',
         'matchzy': 'Auto-Tournament/matchzy-enhanced',
         'inventory': 'ianlucas/cs2-css-inventory-simulator'}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(value, indent=2))
    tmp.chmod(0o640)
    tmp.replace(path)


def read_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def stage(name, **extra):
    previous = read_json(STATE, {})
    atomic_json(STATE, {**previous, 'stage': name, 'bootId': BOOT.read_text().strip(),
                       'updatedAt': time.time(), **extra})
    print('CSBATAGI_UPDATE_STAGE', name, flush=True)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def request(url):
    return urllib.request.Request(url, headers={'User-Agent': 'CSBatagi-server-updater/1',
                                               'Accept': 'application/vnd.github+json'})


def get_json(url):
    with urllib.request.urlopen(request(url), timeout=30) as response:
        return json.load(response)


def download(url, path, digest=None):
    if not url.startswith(('https://github.com/', 'https://api.github.com/', 'https://raw.githubusercontent.com/',
                           'https://builds.dotnet.microsoft.com/', 'https://ci.dot.net/')):
        raise RuntimeError('untrusted_package_url')
    partial = path.with_suffix(path.suffix + '.part')
    with urllib.request.urlopen(request(url), timeout=60) as response, partial.open('wb') as out:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > 1024**3 or shutil.disk_usage(ROOT).free < MIN_FREE:
                raise RuntimeError('package_disk_budget')
            out.write(block)
    if digest and sha(partial) != digest.removeprefix('sha256:'):
        raise RuntimeError('package_checksum')
    partial.replace(path)


def extract(path, target):
    target.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                dest = (target / entry.filename).resolve()
                if not dest.is_relative_to(target.resolve()):
                    raise RuntimeError('archive_path')
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise RuntimeError('archive_symlink')
            archive.extractall(target)
            for entry in archive.infolist():
                if not entry.is_dir() and (entry.external_attr >> 16) & 0o111:
                    (target / entry.filename).chmod(0o750)
    else:
        with tarfile.open(path) as archive:
            archive.extractall(target, filter='data')


def run(args, timeout=900, cwd=None, logfile=None):
    """Kill the whole process group on timeout (SteamCMD and dotnet fork)."""
    env = {**os.environ, 'HOME': str(HOME), 'DOTNET_CLI_TELEMETRY_OPTOUT': '1',
           'DOTNET_NOLOGO': '1', 'DOTNET_PROCESSOR_COUNT': '2'}
    with (logfile or ROOT / 'build.log').open('a') as out:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=out,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RuntimeError('process_timeout') from None
        if code:
            raise RuntimeError('process_exit_' + str(code))


def game_version():
    text = (GAME / 'steam.inf').read_text()
    values = dict(re.findall(r'^(\w+)=(.+)$', text, re.M))
    return {k: values[k] for k in ['PatchVersion', 'ServerVersion']}


def public_build():
    log = ROOT / 'app-info.log'
    log.write_text('')
    run(['/usr/games/steamcmd', '+login', 'anonymous', '+app_info_update', '1',
         '+app_info_print', '730', '+quit'], 180, logfile=log)
    match = re.search(r'"public"\s*\{\s*"buildid"\s*"(\d+)"', log.read_text(errors='replace'))
    if not match:
        raise RuntimeError('public_build_unavailable')
    return match[1]


def current_game(check_remote=False):
    version = game_version()
    text = (HOME / 'cs2/steamapps/appmanifest_730.acf').read_text()
    version['buildId'] = re.search(r'"buildid"\s*"(\d+)"', text)[1]
    required = public_build() if check_remote else read_json(STATE, {}).get('game', {}).get('buildId')
    # UpToDateCheck(730) returned true even for our obsolete September build.
    if required and version['buildId'] != required:
        raise RuntimeError('game_version_not_current')
    return version


def ensure_gameinfo():
    path = GAME / 'gameinfo.gi'
    text = path.read_text()
    if 'Game csgo/addons/metamod' not in text:
        text, count = re.subn(r'(SearchPaths\s*\{)', r'\1\n\t\t\tGame csgo/addons/metamod', text, count=1)
        if count != 1:
            raise RuntimeError('gameinfo_searchpaths')
        path.write_text(text)


def sdk():
    binary = ROOT / 'dotnet/dotnet'
    if binary.exists():
        return binary
    info = get_json('https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json')
    files = info['releases'][0]['sdk']['files']
    asset = next(f for f in files if f['rid'] == 'linux-x64' and f['name'].endswith('.tar.gz'))
    archive = ROOT / 'sdk.tgz'
    download(asset['url'], archive)
    # Microsoft publishes SHA-512 for SDK archives.
    if hashlib.sha512(archive.read_bytes()).hexdigest() != asset['hash']:
        raise RuntimeError('sdk_checksum')
    extract(archive, binary.parent)
    archive.unlink()
    binary.chmod(0o750)
    return binary


def candidate(directory):
    releases = {name: get_json('https://api.github.com/repos/' + repo + '/releases/latest')
                for name, repo in REPOS.items()}
    # Official rolling Metamod build. Resolve its immutable GitHub asset rather
    # than scraping a shell script or executing downloaded updater code.
    meta = get_json('https://api.github.com/repos/alliedmodders/metamod-source/releases?per_page=20')
    meta = next(r for r in meta if r['tag_name'].startswith('2.') and any('linux' in a['name'] and a['name'].endswith('.tar.gz') for a in r['assets']))
    selected = {k: r['tag_name'] for k, r in releases.items()}
    selected['metamod'] = meta['tag_name']
    gamedata_path = 'configs/addons/counterstrikesharp/gamedata/gamedata.json'
    gamedata_commit = get_json('https://api.github.com/repos/' + REPOS['css'] + '/commits?path=' + gamedata_path + '&per_page=1')[0]['sha']
    selected['gamedata'] = gamedata_commit
    integration = hashlib.sha256(b''.join((HERE / n).read_bytes() for n in
        ['patch-matchzy.py', 'CSBatagi.cs', 'patch-inventory.py', 'CSBatagiInventory.cs'])).hexdigest()
    selected['integration'] = integration
    selected['coordinator'] = sha(HERE / 'update-stack.py')
    installed = read_json(ROOT / 'installed.json', {})
    if installed.get('versions') == selected:
        return None
    rejected = read_json(ROOT / 'rejected.json', {})
    if rejected.get('versions') == selected and rejected.get('game') == game_version():
        stage('updating_plugins', warning='candidate_previously_failed')
        return None  # current installed stack must still pass native verification
    directory.mkdir(parents=True, exist_ok=True)
    payload = directory / 'payload'
    asset = next(a for a in releases['css']['assets'] if 'with-runtime-linux' in a['name'] and a['name'].endswith('.zip'))
    css = directory / 'css.zip'
    download(asset['browser_download_url'], css, asset.get('digest'))
    extract(css, payload)
    asset = next(a for a in meta['assets'] if 'linux' in a['name'] and a['name'].endswith('.tar.gz'))
    package = directory / 'metamod.tgz'
    download(asset['browser_download_url'], package, asset.get('digest'))
    extract(package, payload)
    gamedata = payload / 'addons/counterstrikesharp/gamedata/gamedata.json'
    download('https://raw.githubusercontent.com/' + REPOS['css'] + '/' + gamedata_commit + '/' + gamedata_path, gamedata)
    json.loads(gamedata.read_text())
    compiler = sdk()
    for name, repo in [('matchzy', REPOS['matchzy']), ('inventory', REPOS['inventory'])]:
        archive = directory / (name + '.tgz')
        tag = releases[name]['tag_name']
        # Resolve tags to immutable source revision; package records the commit.
        commit = get_json('https://api.github.com/repos/' + repo + '/commits/' + tag)['sha']
        download('https://api.github.com/repos/' + repo + '/tarball/' + commit, archive)
        src_parent = directory / name
        extract(archive, src_parent)
        source = next(p for p in src_parent.iterdir() if p.is_dir())
        src = source / ('src' if name == 'matchzy' else 'source/InventorySimulator')
        integration_file = 'CSBatagi.cs' if name == 'matchzy' else 'CSBatagiInventory.cs'
        shutil.copy2(HERE / integration_file, src / integration_file)
        run([sys.executable, str(HERE / ('patch-matchzy.py' if name == 'matchzy' else 'patch-inventory.py')), str(source)], 60)
        project = source / ('MatchZy.csproj' if name == 'matchzy' else 'InventorySimulator.csproj')
        # Compile against the exact framework package being installed. Preserve
        # the project's runtime-exclusion policy and upstream dependency set.
        text = project.read_text()
        text, count = re.subn(r'(Include="CounterStrikeSharp.API" Version=")[^"]+', r'\g<1>' + releases['css']['tag_name'].removeprefix('v'), text)
        if count != 1:
            raise RuntimeError('api_dependency_changed')
        # CSS 1.0.375+ APIs target .NET 10. Our .NET 8 MatchZy source must
        # follow the framework runtime when rebuilt against those APIs.
        text, count = re.subn(r'<TargetFramework>net(?:8|10)\.0</TargetFramework>', '<TargetFramework>net10.0</TargetFramework>', text)
        if count != 1:
            raise RuntimeError('plugin_runtime_changed')
        project.write_text(text)
        # Reviewed CSS 1.0.375 enum rename; semantics/values are unchanged.
        # Apply to our integration and upstream sources before compilation.
        for code in src.rglob('*.cs'):
            text = code.read_text(encoding='utf-8-sig')
            for old, new in [('PlayerConnected', 'Connected'), ('PlayerConnecting', 'Connecting'),
                             ('PlayerReconnecting', 'Reconnecting')]:
                text = text.replace('PlayerConnectedState.' + old, 'PlayerConnectedState.' + new)
            code.write_text(text, encoding='utf-8')
        dest = payload / 'addons/counterstrikesharp/plugins' / ('MatchZy' if name == 'matchzy' else 'InventorySimulator')
        run([str(compiler), 'publish', str(project), '-c', 'Release', '-o', str(dest), '-m:1',
             '-p:NuGetAudit=false', '-p:UseSharedCompilation=false', '--disable-build-servers'], 600)
        for api in dest.glob('CounterStrikeSharp.API*'):
            api.unlink()
        selected[name + 'Commit'] = commit
        if name == 'inventory':
            shutil.copy2(source / 'gamedata/inventory-simulator.json', payload / 'addons/counterstrikesharp/gamedata/inventory-simulator.json')
            shutil.copytree(src / 'lang', dest / 'lang', dirs_exist_ok=True)
        license_file = next((p for p in [source / 'LICENSE', source / 'License.txt', source / 'LICENSE.md'] if p.exists()), None)
        if license_file:
            shutil.copy2(license_file, dest / license_file.name)
    # Keep the comparison identity separate from immutable source provenance.
    versions = {k: v for k, v in selected.items() if not k.endswith('Commit')}
    return {'versions': versions, 'sources': selected, 'payload': str(payload),
            'hashes': {str(p.relative_to(payload)): sha(p) for p in payload.rglob('*') if p.is_file()}}


def managed_paths(payload):
    """Files upstream packages may replace. Never cfg, admins, demos or state."""
    paths = []
    for path in payload.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(payload)
        if rel.parts[0] != 'addons':
            continue
        if 'configs' in rel.parts:
            continue
        if 'plugins' in rel.parts and rel.parts[rel.parts.index('plugins') + 1] not in ['MatchZy', 'InventorySimulator']:
            continue
        paths.append(rel)
    return paths


def install_package(package):
    payload = pathlib.Path(package['payload'])
    backup = ROOT / 'rollback'
    if backup.exists():
        # This directory is private updater state, never the game/demos directory.
        shutil.rmtree(backup)
    backup.mkdir()
    paths = managed_paths(payload)
    records = []
    for rel in paths:
        current = GAME / rel
        if current.is_symlink():
            raise RuntimeError('managed_file_symlink')
        records.append({'path': str(rel), 'existed': current.is_file()})
        if current.is_file():
            saved = backup / rel
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(current, saved)
    atomic_json(ROOT / 'transaction.json', {'files': records, 'previous': read_json(ROOT / 'installed.json', {}), 'candidate': package})
    for rel in paths:
        dest = GAME / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + '.update')
        shutil.copy2(payload / rel, tmp)
        tmp.replace(dest)
    atomic_json(ROOT / 'pending.json', package)


def rollback(reject=True):
    transaction = read_json(ROOT / 'transaction.json')
    if not transaction:
        return False
    for entry in transaction['files']:
        rel = pathlib.Path(entry['path'])
        if rel.is_absolute() or '..' in rel.parts or rel.parts[0] != 'addons':
            raise RuntimeError('invalid_rollback_path')
        dest = GAME / rel
        if entry['existed']:
            shutil.copy2(ROOT / 'rollback' / rel, dest)
        elif dest.is_file():
            dest.unlink()
    atomic_json(ROOT / 'installed.json', transaction['previous'])
    if reject:
        atomic_json(ROOT / 'rejected.json', {**transaction['candidate'], 'game': game_version()})
    for name in ['pending.json', 'transaction.json']:
        (ROOT / name).unlink(missing_ok=True)
    return True


def prepare():
    ROOT.mkdir(mode=0o750, exist_ok=True)
    with (ROOT / 'update.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if subprocess.run(['pgrep', '-x', 'cs2'], stdout=subprocess.DEVNULL).returncode == 0:
            raise RuntimeError('game_running')
        if subprocess.run(['pgrep', '-x', 'steamcmd'], stdout=subprocess.DEVNULL).returncode == 0:
            raise RuntimeError('steamcmd_running')
        previous = read_json(STATE, {})
        # Recover an interrupted plugin install before touching either package.
        if (ROOT / 'transaction.json').exists():
            rollback(reject=False)
        integration = hashlib.sha256(b''.join((HERE / n).read_bytes() for n in
            ['patch-matchzy.py', 'CSBatagi.cs', 'patch-inventory.py', 'CSBatagiInventory.cs'])).hexdigest()
        cached = (previous.get('bootId') == BOOT.read_text().strip() and previous.get('stage') == 'ready'
                  and read_json(ROOT / 'installed.json', {}).get('versions', {}).get('integration') == integration
                  and read_json(ROOT / 'installed.json', {}).get('versions', {}).get('coordinator') == sha(HERE / 'update-stack.py'))
        stage('checking', operationId=str(uuid.uuid4()), error=None, warning=None, detail=None)
        if shutil.disk_usage(GAME).free < MIN_FREE + 2 * 1024**3:
            raise RuntimeError('insufficient_disk')
        if not cached:
            stage('updating_game')
            log = ROOT / 'steamcmd.log'
            log.write_text('')
            for attempt in range(2):
                try:
                    run(['/usr/games/steamcmd', '+force_install_dir', str(HOME / 'cs2'), '+login', 'anonymous', '+app_update', '730', '+quit'], 1800, logfile=log)
                    if not re.search(r"Success! App '730' (?:fully installed|already up to date)", log.read_text(errors='replace')):
                        raise RuntimeError('steamcmd_no_success')
                    break
                except RuntimeError:
                    if attempt == 1:
                        raise
                    time.sleep(5)
        version = current_game(check_remote=True)
        stage('updating_plugins', game=version)
        work = ROOT / 'candidate'
        if work.exists():
            shutil.rmtree(work)
        try:
            package = candidate(work) if not cached else None
            if package:
                install_package(package)
        except Exception as error:
            # Native verification still decides whether the installed custom
            # stack is usable. Never replace a failed patch with stock binaries.
            if (ROOT / 'transaction.json').exists():
                rollback()
            stage('updating_plugins', warning='plugin_candidate_' + type(error).__name__)
        ensure_gameinfo()
        config = GAME / 'addons/counterstrikesharp/configs/core.json'
        core = read_json(config, {})
        core.update(AutoUpdateEnabled=False, PluginHotReloadEnabled=False)
        atomic_json(config, core)
        stage('verifying')


def rcon():
    spec = importlib.util.spec_from_file_location('local_rcon', HERE / 'rcon-local.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.command


def verify():
    command = rcon()
    deadline = time.monotonic() + 150
    successes = 0
    inventory_started = 0
    inventory_after = time.time()
    last_error = 'startup_verification_failed'
    while time.monotonic() < deadline:
        try:
            status = json.loads(command('csbatagi_status'))
            if not status.get('cstv') or not status.get('warmup') or status.get('demoFailed'):
                raise RuntimeError('game_health')
            plugins = command('css_plugins list')
            if not all(re.search(r'\[#\d+:LOADED\]:\s*"' + name + '"', plugins) for name in ['MatchZy', 'InventorySimulator']):
                raise RuntimeError('plugin_health')
            if time.monotonic() - inventory_started > 15:
                command('csbatagi_inventory_check')
                inventory_started = time.monotonic()
            check = GAME / 'csbatagi-state/inventory-check.json'
            result = read_json(check, {})
            if not check.exists() or check.stat().st_mtime < inventory_after or not result.get('success'):
                raise RuntimeError('inventory_health')
            current_game()
            successes += 1
            if successes >= 3:
                current_game(check_remote=True)
                pending = read_json(ROOT / 'pending.json')
                package = pending or read_json(ROOT / 'installed.json', {})
                combo = {'game': current_game(), 'versions': package.get('versions')}
                if read_json(ROOT / 'verified.json', {}).get('combo') != combo:
                    probe_demo(command)
                    atomic_json(ROOT / 'verified.json', {'combo': combo, 'verifiedAt': time.time()})
                if pending:
                    atomic_json(ROOT / 'installed.json', pending)
                    for name in ['pending.json', 'transaction.json']:
                        (ROOT / name).unlink(missing_ok=True)
                stage('ready', package=read_json(ROOT / 'installed.json', {}).get('versions'), error=None, detail=None)
                return
        except Exception as error:
            last_error = str(error) if isinstance(error, RuntimeError) else type(error).__name__
            stage('verifying', detail=last_error if re.fullmatch(r'[A-Za-z0-9_]+', last_error) else 'verification_error')
            successes = 0
        time.sleep(5)
    raise RuntimeError(last_error)


def probe_demo(command):
    """Native CSTV recording test outside both production worker inventories."""
    directory = ROOT / 'diagnostics'
    directory.mkdir(exist_ok=True)
    path = directory / 'startup-check.dem'
    # The gate is closed and no match is loaded during this test.
    status = json.loads(command('csbatagi_status'))
    if any(status.get(k) for k in ['humans', 'matchLoaded', 'live', 'preparing', 'recording']):
        raise RuntimeError('verification_server_busy')
    path.unlink(missing_ok=True)
    try:
        command('tv_record ' + str(path.with_suffix('')))
        previous = 0
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            time.sleep(5)
            size = path.stat().st_size if path.exists() else 0
            if previous > 64 * 1024 and size > previous:
                with path.open('rb') as source:
                    if source.read(8) != b'PBDEMS2\x00':
                        raise RuntimeError('demo_header')
                return
            previous = size
        raise RuntimeError('demo_not_growing')
    finally:
        command('tv_stoprecord')


def report_loop():
    """Status callback keeps working while the game and RCON are unavailable."""
    while True:
        try:
            value = read_json(STATE, {})
            if value.get('bootId') != BOOT.read_text().strip():
                value = {'stage': 'checking', 'bootId': BOOT.read_text().strip()}
            elif value.get('stage') == 'ready' and subprocess.run(['pgrep', '-x', 'cs2'], stdout=subprocess.DEVNULL).returncode != 0:
                value = {**value, 'stage': 'failed', 'error': 'game_not_running'}
            value['updatedAt'] = time.time()
            token = (GAME / 'cfg/csbatagi-web-token').read_text().strip()
            req = urllib.request.Request('https://csbatagi.com/backend/game-update-status',
                data=json.dumps(value).encode(), method='POST', headers={
                    'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=10):
                pass
        except Exception:
            pass  # private state and game verification do not depend on reporting
        time.sleep(10)


if __name__ == '__main__':
    try:
        {'prepare': prepare, 'verify': verify, 'rollback': rollback, 'report': report_loop}[sys.argv[1]]()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        stage('failed', error=code if re.fullmatch(r'[A-Za-z0-9_]+', code) else 'update_failed')
        raise SystemExit(1)
