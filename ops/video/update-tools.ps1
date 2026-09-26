<#
.SYNOPSIS
  Brings CS2, HLAE and CS Demo Manager on a render machine up to date, and proves they still record.

.DESCRIPTION
  - CS2: Steam updates it. The current patch comes from Steam's public UpToDateCheck API (asked with
    version 0 it answers with the required version, e.g. 14185 = 1.41.8.5); the script waits until the
    local install (appmanifest StateFlags 4, steam.inf PatchVersion) matches.
  - HLAE: follows tools.json, by default the latest stable GitHub release. The archive is verified against
    the SHA-256 digest GitHub publishes for the asset, unpacked into -ToolsRoot\hlae-<version>, and CS Demo
    Manager's settings are pointed at it. The previous copy stays for rollback.
  - CS Demo Manager: pinned in tools.json. Installed silently only with -AllowCsdmInstall, because on a
    desktop that shares the club database its version must match production.
  - Smoke test: whenever the (CS2 patch, HLAE, CS Demo Manager) combination differs from the last one that
    recorded successfully, 8 seconds of -SmokeDemo are recorded and checked. If that fails right after an
    HLAE change, the previous HLAE is restored and tested again. The smoke demo must be recent: CS2 refuses
    demos recorded before its last demo-format change.

  The last output line is a JSON summary for the worker to report. Exit codes: 0 ready, 10 updates pending
  (-CheckOnly), 2 CS2 not up to date in time, 3 smoke test failed.

.EXAMPLE
  .\update-tools.ps1 -CheckOnly

.EXAMPLE
  .\update-tools.ps1 -SmokeDemo C:\render\smoke\latest.dem -AllowCsdmInstall
#>
param(
  [string] $ToolsFile = (Join-Path $PSScriptRoot 'tools.json'),
  [string] $ToolsRoot = "$env:LOCALAPPDATA\csbatagi-render\tools",
  [string] $StateFile = "$env:LOCALAPPDATA\csbatagi-render\tools-state.json",
  [string] $CsdmFolder = "$env:LOCALAPPDATA\Programs\cs-demo-manager",
  [string] $SmokeDemo = '',
  [ValidateSet('x264', 'nvenc')] [string] $Encoder = 'nvenc',
  [int] $Cs2WaitMinutes = 30,
  [switch] $CheckOnly,
  [switch] $AllowCsdmInstall,
  [switch] $ForceSmokeTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$csdmSettingsPath = Join-Path $env:USERPROFILE '.csdm\settings.json'

function Get-ShortVersion([string] $productVersion) {
  if (-not $productVersion) { return $null }
  $v = [version]($productVersion.Split('+')[0])
  return "$($v.Major).$($v.Minor).$($v.Build)"
}

function Get-VdfValue([string] $text, [string] $key) {
  $m = [regex]::Match($text, '"' + [regex]::Escape($key) + '"\s+"([^"]*)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

function Get-Cs2Install {
  $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath -replace '/', '\'
  $libraries = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) {
    $libraries += [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"') | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' }
  }
  foreach ($library in $libraries | Select-Object -Unique) {
    $manifest = Join-Path $library 'steamapps\appmanifest_730.acf'
    if (-not (Test-Path $manifest)) { continue }
    $acf = Get-Content $manifest -Raw
    $inf = Join-Path $library 'steamapps\common\Counter-Strike Global Offensive\game\csgo\steam.inf'
    $patch = if (Test-Path $inf) { (Get-Content $inf | Where-Object { $_ -like 'PatchVersion=*' }) -replace '^PatchVersion=', '' } else { $null }
    return [pscustomobject]@{
      StateFlags = [int](Get-VdfValue $acf 'StateFlags')
      BuildId = Get-VdfValue $acf 'buildid'
      Patch = $patch
      PatchNumber = if ($patch) { [int]($patch -replace '\.', '') } else { 0 }
    }
  }
  throw 'CS2 (app 730) is not installed in any Steam library'
}

function Get-Cs2RequiredPatch {
  try {
    $r = Invoke-RestMethod 'https://api.steampowered.com/ISteamApps/UpToDateCheck/v1/?appid=730&version=0' -TimeoutSec 20
    return [int]$r.response.required_version
  } catch {
    Write-Warning "Steam version check failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-CsdmSettings { Get-Content $csdmSettingsPath -Raw | ConvertFrom-Json }

function Get-HlaeExecutable {
  $hlae = (Get-CsdmSettings).video.hlae
  if ($hlae.customLocationEnabled -and $hlae.customExecutableLocation) { return $hlae.customExecutableLocation }
  return Join-Path $env:USERPROFILE '.csdm\hlae\HLAE.exe'
}

function Set-HlaeExecutable([string] $exe) {
  $settings = Get-CsdmSettings
  $settings.video.hlae.customLocationEnabled = $true
  $settings.video.hlae.customExecutableLocation = $exe
  $settings | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $csdmSettingsPath -Encoding utf8NoBOM
}

function Get-FileVersion([string] $path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return Get-ShortVersion (Get-Item -LiteralPath $path).VersionInfo.ProductVersion
}

function Get-HlaeTarget($spec) {
  if ($spec.version) { return [pscustomobject]@{ Version = $spec.version; Url = $spec.url; Sha256 = $spec.sha256 } }
  $release = Invoke-RestMethod "https://api.github.com/repos/$($spec.repo)/releases/latest" -Headers @{ 'User-Agent' = 'csbatagi-render' } -TimeoutSec 20
  $asset = $release.assets | Where-Object { $_.name -match $spec.assetPattern } | Select-Object -First 1
  if (-not $asset) { throw "No asset matching $($spec.assetPattern) in $($spec.repo) $($release.tag_name)" }
  if ($asset.digest -notmatch '^sha256:([0-9a-f]{64})$') { throw "GitHub publishes no SHA-256 digest for $($asset.name); refusing to install it" }
  return [pscustomobject]@{ Version = $release.tag_name.TrimStart('v'); Url = $asset.browser_download_url; Sha256 = $Matches[1] }
}

function Save-VerifiedDownload([string] $url, [string] $sha256) {
  $file = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetFileName(([uri]$url).LocalPath))
  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $sha256.ToLowerInvariant()) {
    Remove-Item -LiteralPath $file -Force
    throw "SHA-256 mismatch for $url (expected $sha256, got $actual)"
  }
  return $file
}

function Invoke-SmokeTest {
  $out = Join-Path (Split-Path $StateFile) 'smoke'
  if (Test-Path $out) { Remove-Item $out -Recurse -Force }
  try {
    & (Join-Path $PSScriptRoot 'record-demo.ps1') -DemoPath $SmokeDemo -OutputFolder $out -Rounds 1 -MaxSeconds 8 `
      -Encoder $Encoder -CsdmFolder $CsdmFolder *>&1 | Out-Host
    $video = Get-ChildItem -LiteralPath $out -File -Filter '*.mp4' | Select-Object -First 1
    if (-not $video) { return 'no video' }
    $ffprobe = Join-Path $env:USERPROFILE '.csdm\ffmpeg\bin\ffprobe.exe'
    $probe = & $ffprobe -v error -select_streams v:0 -show_entries 'stream=width,height:format=duration' -of json $video.FullName | ConvertFrom-Json
    $duration = [double]$probe.format.duration
    if ($duration -lt 7 -or $duration -gt 9) { return "unexpected duration $duration s" }
    if ($probe.streams[0].width -ne 1920) { return "unexpected width $($probe.streams[0].width)" }
    return $null
  } catch {
    return $_.Exception.Message
  } finally {
    Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$summary = [ordered]@{ status = 'ready'; cs2 = $null; hlae = $null; csdm = $null; changes = @(); message = $null }
$exitCode = 0
$state = if (Test-Path $StateFile) { Get-Content $StateFile -Raw | ConvertFrom-Json } else { $null }
$tools = Get-Content $ToolsFile -Raw | ConvertFrom-Json

# CS2
$required = Get-Cs2RequiredPatch
$cs2 = Get-Cs2Install
$cs2Current = { param($c) $c.StateFlags -eq 4 -and (-not $required -or $c.PatchNumber -ge $required) }
if (-not (& $cs2Current $cs2)) {
  if ($CheckOnly) {
    $summary.changes += "cs2 $($cs2.Patch) -> required $required (StateFlags $($cs2.StateFlags))"
  } else {
    Write-Host "Waiting for Steam to update CS2 ($($cs2.Patch), required $required)..."
    $deadline = (Get-Date).AddMinutes($Cs2WaitMinutes)
    while (-not (& $cs2Current $cs2) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 15
      $cs2 = Get-Cs2Install
    }
    if (-not (& $cs2Current $cs2)) {
      $summary.status = 'cs2-update-timeout'
      $summary.message = "CS2 is $($cs2.Patch) (StateFlags $($cs2.StateFlags)), Steam requires $required"
      $exitCode = 2
    }
  }
}
$summary.cs2 = "$($cs2.Patch) (build $($cs2.BuildId))"

# HLAE
$hlaeExe = Get-HlaeExecutable
$hlaeInstalled = Get-FileVersion $hlaeExe
$previousHlaeExe = $null
try {
  $hlaeTarget = Get-HlaeTarget $tools.hlae
  if ($hlaeInstalled -ne $hlaeTarget.Version) {
    if ($CheckOnly) {
      $summary.changes += "hlae $hlaeInstalled -> $($hlaeTarget.Version)"
    } elseif ($exitCode -eq 0) {
      Write-Host "Installing HLAE $($hlaeTarget.Version)..."
      $folder = Join-Path $ToolsRoot "hlae-$($hlaeTarget.Version)"
      if (-not (Test-Path (Join-Path $folder 'HLAE.exe'))) {
        $zip = Save-VerifiedDownload $hlaeTarget.Url $hlaeTarget.Sha256
        Expand-Archive -LiteralPath $zip -DestinationPath $folder -Force
        Remove-Item -LiteralPath $zip -Force
      }
      $previousHlaeExe = $hlaeExe
      Set-HlaeExecutable (Join-Path $folder 'HLAE.exe')
      $hlaeInstalled = $hlaeTarget.Version
      $summary.changes += "hlae -> $hlaeInstalled"
    }
  }
} catch {
  Write-Warning "HLAE check failed, keeping $hlaeInstalled`: $($_.Exception.Message)"
}
$summary.hlae = $hlaeInstalled

# CS Demo Manager
$csdmExe = Join-Path $CsdmFolder 'cs-demo-manager.exe'
$csdmInstalled = Get-FileVersion $csdmExe
if ($csdmInstalled -ne $tools.csdm.version) {
  if ($CheckOnly -or -not $AllowCsdmInstall) {
    $summary.changes += "csdm $csdmInstalled -> $($tools.csdm.version)$(if (-not $CheckOnly) { ' (not installed: -AllowCsdmInstall not given)' })"
  } elseif ($exitCode -eq 0) {
    Write-Host "Installing CS Demo Manager $($tools.csdm.version)..."
    $installer = Save-VerifiedDownload $tools.csdm.url $tools.csdm.sha256
    Start-Process -FilePath $installer -ArgumentList '/S' -Wait
    Remove-Item -LiteralPath $installer -Force
    $csdmInstalled = Get-FileVersion $csdmExe
    if ($csdmInstalled -ne $tools.csdm.version) { throw "CS Demo Manager is $csdmInstalled after installing $($tools.csdm.version)" }
    $summary.changes += "csdm -> $csdmInstalled"
  }
}
$summary.csdm = $csdmInstalled

if ($CheckOnly) {
  if ($summary.changes.Count -gt 0) { $summary.status = 'updates-pending'; $exitCode = 10 }
} elseif ($exitCode -eq 0) {
  $combo = [ordered]@{ cs2 = $cs2.Patch; hlae = $hlaeInstalled; csdm = $csdmInstalled; encoder = $Encoder }
  $known = $state -and $state.lastGood -and ($state.lastGood.cs2 -eq $combo.cs2) -and ($state.lastGood.hlae -eq $combo.hlae) `
    -and ($state.lastGood.csdm -eq $combo.csdm) -and ($state.lastGood.encoder -eq $combo.encoder)
  if ($SmokeDemo -and (-not $known -or $ForceSmokeTest)) {
    Write-Host "Smoke test: CS2 $($combo.cs2), HLAE $($combo.hlae), CS Demo Manager $($combo.csdm), $Encoder..."
    $failure = Invoke-SmokeTest
    if ($failure -and $previousHlaeExe) {
      Write-Warning "Smoke test failed with HLAE $hlaeInstalled ($failure); restoring $previousHlaeExe"
      Set-HlaeExecutable $previousHlaeExe
      $combo.hlae = Get-FileVersion $previousHlaeExe
      $summary.hlae = $combo.hlae
      $summary.changes += "hlae rolled back -> $($combo.hlae)"
      $failure = Invoke-SmokeTest
    }
    if ($failure) {
      $summary.status = 'tools-incompatible'
      $summary.message = "Smoke test failed: $failure"
      $exitCode = 3
    } else {
      $combo.at = (Get-Date).ToUniversalTime().ToString('o')
      New-Item -ItemType Directory -Force -Path (Split-Path $StateFile) | Out-Null
      [ordered]@{ lastGood = $combo } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding utf8NoBOM
    }
  } elseif (-not $known) {
    $summary.message = 'No smoke test run (no -SmokeDemo); this combination has not been proven to record'
  }
}

$summary | ConvertTo-Json -Compress
exit $exitCode
