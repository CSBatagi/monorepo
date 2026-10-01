"""Small, checked integration patch for the pinned upstream checkout."""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

def replace(file, old, new):
    path = root / file
    text = path.read_text(encoding='utf-8-sig')
    if new in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f'{file}: expected one integration point: {old[:60]}')
    path.write_text(text.replace(old, new), encoding='utf-8', newline='\n')

def replace_variant(file, variants, new):
    """Accept explicitly reviewed upstream variants; never silently skip a patch."""
    text = (root / file).read_text(encoding='utf-8-sig')
    if new in text:
        return
    matches = [old for old in variants if text.count(old) == 1]
    if len(matches) != 1:
        raise RuntimeError(f'{file}: expected one reviewed integration variant')
    replace(file, matches[0], new)

replace('src/MatchZy.cs', 'public override void Load(bool hotReload)\n        {',
        'public override void Load(bool hotReload)\n        {\n            InitializeBatagi();')
replace('src/MatchManagement.cs',
        'string headerValue = command.ArgCount > 3 ? command.ArgByIndex(3) : "";',
        '''string headerValue = command.ArgCount > 3 ? command.ArgByIndex(3) : "";
            // Only attach the private website credential to our exact HTTPS endpoint.
            if (headerName == "" && Uri.TryCreate(url, UriKind.Absolute, out var batagiUri)
                && batagiUri.Scheme == "https" && batagiUri.Host == "csbatagi.com"
                && batagiUri.IsDefaultPort && batagiUri.AbsolutePath.StartsWith("/backend/get-match/"))
            {
                var tokenPath = Path.Combine(Server.GameDirectory, "csgo", "cfg", "csbatagi-web-token");
                if (File.Exists(tokenPath)) { headerName = "Authorization"; headerValue = "Bearer " + File.ReadAllText(tokenPath).Trim(); }
            }''')
replace_variant('src/MatchManagement.cs', [
        'Log($"[LoadMatchDataCommand] Match setup request received with URL: {url} headerName: {headerName} and headerValue: {headerValue}");',
        'Log($"[LoadMatchDataCommand] Match setup request received with URL: {SecretRedactor.RedactText(url)} header: {SecretRedactor.FormatCustomHeader(headerName, headerValue)}");'],
        'Log($"[LoadMatchDataCommand] Match setup request received with URL: {url}; credentials redacted.");')
replace('src/MatchManagement.cs',
        'if (isMatchSetup)\n            {\n                string currentStatus = tournamentStatus.Value ?? string.Empty;',
        'if (isMatchSetup && !BatagiCanReplaceWarmup)\n            {\n                string currentStatus = tournamentStatus.Value ?? string.Empty;')
replace_variant('src/MatchManagement.cs', [
        'Log($"[LoadMatchFromURL] Received following data: {jsonData}");',
        'Log($"[LoadMatchFromURL] Received following data: {SecretRedactor.RedactText(jsonData)}");'],
        '''// Fetch and validate before discarding the previous warmup roster.
                    var replacement = JObject.Parse(jsonData);
                    if (ValidateMatchJsonStructure(replacement) != "")
                    {
                        command.ReplyToCommand("CSBATAGI_LOAD_ERROR: Invalid match configuration");
                        return;
                    }
                    if (isMatchSetup)
                    {
                        if (!BatagiCanReplaceWarmup)
                        {
                            command.ReplyToCommand("CSBATAGI_LOAD_ERROR: Match is already active");
                            return;
                        }
                        ResetMatch(false);
                    }''')
replace('src/MatchManagement.cs',
        '            SetTeamNames();\n            UpdatePlayersMap();\n            UpdateHostname();',
        '            SetTeamNames();\n            UpdatePlayersMap();\n            BatagiAssignWarmupTeams();\n            UpdateHostname();')
replace('src/Utility.cs',
        'private void UnpauseMatch()\n        {',
        '''private void UnpauseMatch()
        {
            if (isMatchLive && (batagiPreparing || batagiDemoFailed))
            {
                PrintToAllChat("[CS Batagi] Waiting for a healthy demo recording before unpausing.");
                return;
            }''')
replace('src/Utility.cs', 'private void StartLive()', 'private void BatagiAnnounceLive()')
replace_variant('src/Utility.cs', [
        'private void ResetMatch(bool warmupCfgRequired = true)\n        {',
        'private void ResetMatch(bool warmupCfgRequired = true, bool loadQueuedMatch = false)\n        {'],
        'private void ResetMatch(bool warmupCfgRequired = true, bool loadQueuedMatch = false)\n        {\n            BatagiReset();')
replace('src/Utility.cs',
        'public void KickPlayer(CCSPlayerController player, string? reason = null)\n        {',
        'public void KickPlayer(CCSPlayerController player, string? reason = null)\n        {\n            if (player != null && player.IsValid && BatagiIsTv(player)) return;')
replace('src/DatabaseStats.cs',
        'await connection.ExecuteAsync(sqlQuery, new { matchId, winnerName, t1score, t2score });',
        'using IDbConnection endConnection = connection is SqliteConnection\n                    ? new SqliteConnection(connection.ConnectionString)\n                    : new MySqlConnection(connection.ConnectionString);\n                await endConnection.ExecuteAsync(sqlQuery, new { matchId, winnerName, t1score, t2score });')
replace('src/Utility.cs',
        '            SetupLiveFlagsAndCfg();\n            CrashBreadcrumb("StartLive: after SetupLiveFlagsAndCfg");\n            StartDemoRecording();',
        '            // Live configuration and recording have passed CS Batagi preflight.')
demo_text = (root / 'src/DemoManagement.cs').read_text(encoding='utf-8-sig')
if 'string demoFileName = DemoFileName.Build(' in demo_text:
    replace('src/DemoManagement.cs', '                team2Score) + ".dem";',
            '                team2Score) + "_" + Guid.NewGuid().ToString("N")[..8] + ".dem";')
else:
    replace('src/DemoManagement.cs',
            'string demoFileName = FormatCvarValue(demoNameFormat.Replace(" ", "_")) + ".dem";',
            'string demoFileName = System.Text.RegularExpressions.Regex.Replace(FormatCvarValue(demoNameFormat), @"[^A-Za-z0-9_.-]", "_") + "_" + Guid.NewGuid().ToString("N")[..8] + ".dem";')
replace_variant('src/DemoManagement.cs', [
        'Log($"[StartDemoRecording] Demo recording started successfully.");',
        'Log($"[StartDemoRecording] Demo recording started{(sourceTvActive ? " successfully" : " (SourceTV missing, demo likely not written)")}.");'],
        'BatagiRecordingStarted();\n                Log("[StartDemoRecording] Recording requested; awaiting file growth verification.");')
replace('src/DemoManagement.cs',
        '            AddTimer(delay, () =>\n            {\n                if (isDemoRecording)',
        '            AddTimer(delay, () =>\n            {\n                if (this.activeDemoFile != activeDemoFile) return;\n                BatagiCloseMarker(activeDemoFile, "closed");\n                if (isDemoRecording)')
for path in (root / 'src').glob('*.cs'):
    if path.name == 'CSBatagi.cs':
        continue
    text = path.read_text(encoding='utf-8-sig')
    text = text.replace('Server.ExecuteCommand("bot_kick");', 'BatagiKickBots();')
    text = text.replace('bot_quota_mode normal; bot_kick; bot_quota 0', 'bot_quota_mode normal; bot_quota 0')
    path.write_text(text, encoding='utf-8', newline='\n')
print('Applied CS Batagi integrations to pinned source.')
