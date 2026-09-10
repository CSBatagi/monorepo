// Compiled into the pinned MatchZy Enhanced build by build.ps1.
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Cvars;
using CounterStrikeSharp.API.Modules.Menu;
using CounterStrikeSharp.API.Modules.Timers;
using System.Text.Json;

namespace MatchZy;

public partial class MatchZy
{
    private bool batagiPreparing;
    private bool batagiDemoFailed;
    private bool batagiWarmupApplied;
    private int batagiGeneration;
    private string batagiObservedFile = "";
    private long batagiObservedBytes;
    private DateTime batagiLastGrowth = DateTime.UtcNow;
    private DateTime batagiDemoStarted = DateTime.UtcNow;
    private readonly Dictionary<ulong, string> batagiGuns = new();
    private readonly string[] batagiWeapons = { "ak47", "m4a1", "m4a1_silencer", "awp", "ssg08", "aug", "sg556", "mp9", "mac10", "deagle" };
    private string BatagiStateDir => Path.Combine(Server.GameDirectory, "csgo", "csbatagi-state");
    private static bool BatagiIsTv(CCSPlayerController p) => p.IsHLTV || (p.IsBot && p.TeamNum == 0 && p.PlayerName == "SourceTV");

    private void InitializeBatagi()
    {
        Directory.CreateDirectory(BatagiStateDir);
        AddCommandListener("bot_kick", (p, c) => { BatagiKickBots(); return HookResult.Handled; });
        AddCommandListener("kickid", (p, c) =>
        {
            if (int.TryParse(c.GetArg(1), out var id) && Utilities.GetPlayers().Any(x => x.IsValid && x.UserId == id && BatagiIsTv(x)))
            { Log("[CSBatagi] Blocked command attempting to kick CSTV."); return HookResult.Handled; }
            return HookResult.Continue;
        });
        RegisterEventHandler<EventCsWinPanelMatch>((e, i) =>
        {
            var finishedId = liveMatchId;
            var finishedGeneration = batagiGeneration;
            AddTimer(45, () =>
            {
                if (batagiGeneration != finishedGeneration || liveMatchId != finishedId || isDemoRecording || matchConfig.NumMaps != 1) return;
                ResetMatch(false);
                Server.ExecuteCommand("exec MatchZy/warmup.cfg");
                if (!Utilities.GetPlayers().Any(p => p.IsValid && BatagiIsTv(p)))
                    Server.ExecuteCommand("changelevel " + Server.MapName);
            }, TimerFlags.STOP_ON_MAPCHANGE);
            return HookResult.Continue;
        });
        AddCommand("css_guns", "Choose a warmup weapon", (p, c) =>
        {
            if (p == null || !p.IsValid || !isWarmup || matchStarted) return;
            var menu = new ChatMenu("CS Batagi warmup guns");
            foreach (var weapon in batagiWeapons)
                menu.AddMenuOption(weapon, (player, _) => { batagiGuns[player.SteamID] = weapon; BatagiGiveGun(player); });
            MenuManager.OpenChatMenu(p, menu);
        });
        RegisterEventHandler<EventPlayerSpawn>((e, _) =>
        {
            var p = e.Userid;
            AddTimer(0.1f, () => { if (p?.IsValid == true) BatagiGiveGun(p); }, TimerFlags.STOP_ON_MAPCHANGE);
            return HookResult.Continue;
        });
        RegisterListener<Listeners.OnMapEnd>(() =>
        {
            BatagiCloseMarker(activeDemoFile, "map-ended");
            batagiGeneration++;
            batagiPreparing = false;
            batagiDemoFailed = false;
            batagiObservedFile = "";
            isDemoRecording = false;
        });
        AddCommand("csbatagi_status", "Machine-readable match and recording status", (p, c) =>
        {
            if (p == null) c.ReplyToCommand(BatagiStatus());
        });
        AddCommand("csbatagi_players", "Player diagnostics; server console only", (p, c) =>
        {
            if (p == null) c.ReplyToCommand(JsonSerializer.Serialize(Utilities.GetPlayers().Select(x => new { x.PlayerName, x.UserId, x.Index, x.Slot, x.IsBot, x.IsHLTV, x.TeamNum })));
        });
        AddCommand("csbatagi_retry_demo", "Retry a failed demo; admin console only", (p, c) =>
        {
            if (p != null || !isMatchLive || !batagiDemoFailed) return;
            Server.ExecuteCommand("tv_stoprecord");
            BatagiCloseMarker(activeDemoFile, "interrupted");
            isDemoRecording = false;
            var retryGeneration = batagiGeneration;
            AddTimer(2, () => { if (retryGeneration != batagiGeneration || !isMatchLive) return; StartDemoRecording(); batagiDemoFailed = false; }, TimerFlags.STOP_ON_MAPCHANGE);
        });
        AddTimer(5, BatagiTick, TimerFlags.REPEAT);
        Log("[CSBatagi] Warmup, CSTV voice routing and demo verification loaded.");
    }

    private void BatagiGiveGun(CCSPlayerController p)
    {
        if (!isWarmup || matchStarted || p.IsBot || p.IsHLTV || !p.PawnIsAlive || p.TeamNum < 2) return;
        var gun = batagiGuns.GetValueOrDefault(p.SteamID, "ak47");
        p.RemoveWeapons();
        p.GiveNamedItem("weapon_knife");
        if (gun != "deagle") p.GiveNamedItem("weapon_deagle");
        p.GiveNamedItem("weapon_" + gun);
    }

    // Never use an unqualified bot_kick: CSTV is a fake client too.
    private void BatagiKickBots()
    {
        Server.ExecuteCommand("bot_quota 0");
        foreach (var p in Utilities.GetPlayers().Where(p => p.IsValid && p.IsBot && !BatagiIsTv(p) && p.TeamNum >= 2 && p.UserId.HasValue))
            Server.ExecuteCommand($"kickid {p.UserId!.Value}");
    }

    private void StartLive()
    {
        if (batagiPreparing) return;
        var free = new DriveInfo(Path.GetPathRoot(Server.GameDirectory)!).AvailableFreeSpace;
        if (free < 4L * 1024 * 1024 * 1024 || !Utilities.GetPlayers().Any(p => p.IsValid && BatagiIsTv(p)))
        {
            PrintToAllChat("[CS Batagi] Match blocked: recording requires CSTV and 4 GiB free disk. Contact an admin.");
            return;
        }
        batagiPreparing = true;
        var startGeneration = batagiGeneration;
        batagiDemoFailed = false;
        if (!isSimulationMode) BatagiKickBots();
        SetupLiveFlagsAndCfg();
        // Console writes to this cheat-protected cvar are ignored with sv_cheats=0.
        ConVar.Find("sv_infinite_ammo")?.SetValue(0);
        // Hold the pistol freeze while live.cfg ends warmup and the recorder starts.
        Server.ExecuteCommand("mp_pause_match");
        PrintToAllChat("[CS Batagi] Checking demo recording before releasing the pistol round...");
        AddTimer(3, () =>
        {
            if (startGeneration != batagiGeneration || !batagiPreparing || !isMatchLive) return;
            Server.ExecuteCommand("mp_pause_match");
            StartDemoRecording();
        }, TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void BatagiReset()
    {
        if (isDemoRecording) BatagiCloseMarker(activeDemoFile, "reset");
        batagiGeneration++;
        batagiPreparing = false;
        batagiDemoFailed = false;
        batagiWarmupApplied = false;
    }

    private void BatagiRecordingStarted()
    {
        batagiObservedFile = activeDemoFile;
        batagiObservedBytes = 0;
        batagiLastGrowth = batagiDemoStarted = DateTime.UtcNow;
        batagiDemoFailed = false;
    }

    private void BatagiCloseMarker(string relative, string state)
    {
        if (string.IsNullOrEmpty(relative)) return;
        var path = Path.Combine(Server.GameDirectory, "csgo", relative);
        try { if (!File.Exists(path + ".closed.json")) File.WriteAllText(path + ".closed.json", JsonSerializer.Serialize(new { state, matchId = liveMatchId, closedAt = DateTime.UtcNow })); }
        catch (Exception e) { Log("[CSBatagi] Cannot mark closed demo: " + e.Message); }
    }

    private string BatagiStatus()
    {
        JsonElement? uploads = null;
        try { using var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(BatagiStateDir, "uploads.json"))); uploads = JsonSerializer.SerializeToElement(new { updatedAt = document.RootElement.GetProperty("updatedAt"), pending = document.RootElement.GetProperty("pending"), demos = document.RootElement.GetProperty("demos").EnumerateArray().Take(5).Select(x => x.Clone()).ToArray() }); } catch { }
        var players = Utilities.GetPlayers().Where(p => p.IsValid).ToList();
        var tv = players.FirstOrDefault(BatagiIsTv);
        return JsonSerializer.Serialize(new {
            time = DateTime.UtcNow, map = Server.MapName, matchId = liveMatchId,
            warmup = isWarmup, live = isMatchLive, matchLoaded = isMatchSetup,
            paused = isPaused,
            preparing = batagiPreparing, recording = isDemoRecording, demoFailed = batagiDemoFailed,
            demo = activeDemoFile, bytes = batagiObservedBytes,
            cstv = tv != null, cstvVoiceFlags = tv?.VoiceFlags.ToString(),
            humans = players.Count(p => !p.IsBot && !p.IsHLTV),
            bots = players.Count(p => p.IsBot && !BatagiIsTv(p)),
            playersPerTeam = matchConfig.PlayersPerTeam,
            simulation = isSimulationMode, uploads
        });
    }

    private void BatagiTick()
    {
        try
        {
            var players = Utilities.GetPlayers().Where(p => p.IsValid).ToList();
            // Apply listen-all ONLY to CSTV, leaving human team voice isolation intact.
            foreach (var tv in players.Where(BatagiIsTv)) tv.VoiceFlags = VoiceFlags.All | VoiceFlags.ListenAll;
            if (isWarmup && !matchStarted && !isPractice && !isSimulationMode)
            {
                if (!batagiWarmupApplied) { Server.ExecuteCommand("exec MatchZy/warmup.cfg"); batagiWarmupApplied = true; }
                Server.ExecuteCommand("mp_warmup_pausetimer 1; mp_respawn_on_death_ct 1; mp_respawn_on_death_t 1; mp_free_armor 2");
                ConVar.Find("sv_infinite_ammo")?.SetValue(2);
                int humans = players.Count(p => !p.IsBot && !p.IsHLTV);
                int desiredBots = humans == 0 ? 0 : Math.Max(0, 6 - humans);
                var bots = players.Where(p => p.IsBot && !BatagiIsTv(p) && p.TeamNum >= 2).ToList();
                // Keep the target far below the player cap, preserving CSTV headroom.
                if (bots.Count > desiredBots)
                    foreach (var bot in bots.Skip(desiredBots).Where(p => p.UserId.HasValue)) Server.ExecuteCommand($"kickid {bot.UserId!.Value}");
                Server.ExecuteCommand($"bot_quota_mode normal; bot_quota {desiredBots}");
            }
            else batagiWarmupApplied = false;
            if (isDemoRecording && !string.IsNullOrEmpty(activeDemoFile))
            {
                if (batagiObservedFile != activeDemoFile) BatagiRecordingStarted();
                string path = Path.Combine(Server.GameDirectory, "csgo", activeDemoFile);
                long size = File.Exists(path) ? new FileInfo(path).Length : 0;
                bool grew = size > batagiObservedBytes;
                if (grew) batagiLastGrowth = DateTime.UtcNow;
                batagiObservedBytes = size;
                int delay = ConVar.Find("tv_delay")?.GetPrimitiveValue<int>() ?? 0;
                if (batagiPreparing && grew && size > 256 * 1024 && (DateTime.UtcNow - batagiDemoStarted).TotalSeconds > delay + 5)
                {
                    batagiPreparing = false;
                    ConVar.Find("sv_infinite_ammo")?.SetValue(0);
                    BatagiAnnounceLive();
                    Server.ExecuteCommand("mp_unpause_match");
                    PrintToAllChat("[CS Batagi] Demo is growing. Team voice is routed to CSTV. Match live!");
                }
                if (!batagiDemoFailed && (DateTime.UtcNow - batagiLastGrowth).TotalSeconds > Math.Max(90, delay + 60))
                {
                    batagiDemoFailed = true;
                    ForcePauseMatch(null, null);
                    Server.ExecuteCommand("mp_pause_match");
                    PrintToAllChat("[CS Batagi] DEMO FAILURE: recording stopped growing. Pause requested; contact an admin.");
                    Log("[CSBatagi] DEMO FAILURE " + activeDemoFile);
                }
            }
            var temporary = Path.Combine(BatagiStateDir, "status.json.tmp");
            File.WriteAllText(temporary, BatagiStatus());
            File.Move(temporary, Path.Combine(BatagiStateDir, "status.json"), true);
        }
        catch (Exception e) { Log("[CSBatagi] Monitor error: " + e.Message); }
    }
}
