using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using Microsoft.Extensions.Logging;

namespace InventorySimulator;

// Shared web token is read from the existing private file, never a client-visible convar.
public static class CSBatagiInventoryApi
{
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10) };
    private static string TokenPath = "";
    public static string DiagnosticPath { get; private set; } = "";
    // Server.GameDirectory invokes an engine native and must be captured on the main thread.
    public static void Initialize()
    {
        TokenPath = Path.Combine(Server.GameDirectory, "csgo/cfg/csbatagi-web-token");
        DiagnosticPath = Path.Combine(Server.GameDirectory, "csgo/csbatagi-state/inventory-check.json");
    }
    public static HttpRequestMessage Request(HttpMethod method, string url)
    {
        var uri = new Uri(url);
        if (uri.Scheme != "https" || uri.Host != "csbatagi.com" || !uri.IsDefaultPort || !uri.AbsolutePath.StartsWith("/backend/cosmetics/"))
            throw new InvalidOperationException("Unexpected inventory API destination");
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", File.ReadAllText(TokenPath).Trim());
        return request;
    }
    public static async Task<HttpResponseMessage> GetAsync(string url)
    {
        using var request = Request(HttpMethod.Get, url);
        return await Client.SendAsync(request);
    }
    public static async Task<bool> LinkAsync(string steamId, string code)
    {
        using var request = Request(HttpMethod.Post, "https://csbatagi.com/backend/cosmetics/server/link");
        request.Content = JsonContent.Create(new { steamId, code });
        using var response = await Client.SendAsync(request);
        return response.IsSuccessStatusCode;
    }
}

public partial class InventorySimulator
{
    [ConsoleCommand("csbatagi_inventory_check", "Server-only authenticated cosmetics API check")]
    public void OnCSBatagiInventoryCheck(CCSPlayerController? player, CommandInfo command)
    {
        if (player != null) return;
        _ = Task.Run(async () =>
        {
            try
            {
                using var response = await CSBatagiInventoryApi.GetAsync("https://csbatagi.com/backend/cosmetics/api/equipped/v5/76561198000000001.json");
                response.EnsureSuccessStatusCode();
                var inventory = JsonSerializer.Deserialize<EquippedV5Response>(await response.Content.ReadAsStringAsync());
                Logger.LogInformation("[CSBatagi Inventory] API OK; v5 parsed={Parsed}", inventory != null);
                File.WriteAllText(CSBatagiInventoryApi.DiagnosticPath, JsonSerializer.Serialize(new { checkedAt = DateTime.UtcNow, success = inventory != null }));
            }
            catch (Exception error)
            {
                Logger.LogWarning("[CSBatagi Inventory] API check failed: {ErrorType}", error.GetType().Name);
            }
        });
    }

    [ConsoleCommand("css_bagla", "Link your Steam account using the code from csbatagi.com/ekipman")]
    public void OnCSBatagiLink(CCSPlayerController? player, CommandInfo command)
    {
        if (player == null || !player.IsValid || player.IsBot || player.SteamID == 0) return;
        var code = command.GetArg(1).Trim().ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-F0-9]{16}$"))
        {
            player.PrintToChat("[CS Batagi] csbatagi.com/ekipman > Steam bagla > !bagla KOD");
            return;
        }
        var steamId = player.SteamID;
        var state = player.GetState();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (now - state.WsUpdatedAt < 10) return;
        state.WsUpdatedAt = now;
        _ = Task.Run(async () =>
        {
            bool success;
            try { success = await CSBatagiInventoryApi.LinkAsync(steamId.ToString(), code); }
            catch { success = false; }
            Server.NextFrame(() =>
            {
                if (!player.IsValid || player.SteamID != steamId) return;
                player.PrintToChat(success ? "[CS Batagi] Steam baglandi! csbatagi.com/ekipman sayfasini yenileyin." : "[CS Batagi] Baglanamadi. Web sitesinden yeni kod alip tekrar deneyin.");
            });
        });
    }
}
