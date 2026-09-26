<#
.SYNOPSIS
  Records a whole-match video of a CS2 demo with CS Demo Manager, without touching the app's UI.

.DESCRIPTION
  1. `csdm json` analyzes the demo into the local CS Demo Manager database if needed and exports rounds,
     kills and players.
  2. build-video-config.js turns that export into a sequence: freeze-time end of round 1 to one second
     after the last kill (or last round end), killer camera two seconds before each kill, voices on,
     X-ray off.
  3. `csdm video --config-file` starts CS2 (through HLAE), records, encodes with FFmpeg and closes the game.

  The CLI exits 0 even when something fails, so success is decided by the video file on disk.
  Needs Steam running and signed in, CS2 installed, and CS Demo Manager's database reachable.

  CS2 cannot open paths longer than 260 characters: it then ignores CS Demo Manager's actions file and
  plays the demo without recording. The demo is therefore hard-linked (or copied) into -StagingFolder.
  If recording has not started after -StartTimeoutMinutes (demo from an older CS2 version, actions not
  loaded, map download stuck) or the run exceeds three times the footage length plus 15 minutes, CS2 is
  closed and the script fails.

.EXAMPLE
  .\record-demo.ps1 -DemoPath C:\demos\match.dem -OutputFolder C:\videos

.EXAMPLE
  # First two rounds only, encoded on the NVIDIA GPU (what the render servers use)
  .\record-demo.ps1 -DemoPath C:\demos\match.dem -OutputFolder C:\videos -Rounds 2 -Encoder nvenc

.EXAMPLE
  # Round 20 to the end of the match, to check the ending
  .\record-demo.ps1 -DemoPath C:\demos\match.dem -OutputFolder C:\videos -Rounds 20-
#>
param(
  [Parameter(Mandatory = $true)] [string] $DemoPath,
  [Parameter(Mandatory = $true)] [string] $OutputFolder,
  [string] $Source = 'matchzy',
  [ValidateSet('x264', 'nvenc')] [string] $Encoder = 'x264',
  [string] $Rounds = '',
  [int] $MaxSeconds = 0,
  [int] $Width = 1920,
  [int] $Height = 1080,
  [int] $Framerate = 60,
  [string] $CsdmFolder = "$env:LOCALAPPDATA\Programs\cs-demo-manager",
  [string] $StagingFolder = "$env:LOCALAPPDATA\csbatagi-render",
  [int] $StartTimeoutMinutes = 8,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$demo = (Resolve-Path -LiteralPath $DemoPath).Path
# Unpacking a downloaded .dem.gz often creates a folder named like the demo, with the demo inside.
if (Test-Path -LiteralPath $demo -PathType Container) {
  $inside = @(Get-ChildItem -LiteralPath $demo -File -Filter '*.dem')
  if ($inside.Count -ne 1) { throw "Expected exactly one .dem file in folder $demo" }
  $demo = $inside[0].FullName
}
if (-not $demo.EndsWith('.dem')) { throw "Not a .dem file: $demo" }
New-Item -ItemType Directory -Force -Path $OutputFolder | Out-Null
$output = (Resolve-Path -LiteralPath $OutputFolder).Path

$csdm = Join-Path $CsdmFolder 'csdm.cmd'
$runtime = Join-Path $CsdmFolder 'cs-demo-manager.exe'
if (-not (Test-Path $csdm)) { throw "CS Demo Manager CLI not found at $csdm" }

$stem = [IO.Path]::GetFileNameWithoutExtension($demo)
$work = Join-Path $output ".work-$stem"
New-Item -ItemType Directory -Force -Path $work | Out-Null

Write-Host "Exporting match data..."
& $csdm json $demo --output-folder $work --source $Source
$matchJson = Join-Path $work "$stem.json"
if (-not (Test-Path $matchJson)) { throw "csdm json did not produce $matchJson (is the database reachable?)" }

New-Item -ItemType Directory -Force -Path $StagingFolder | Out-Null
$staged = Join-Path (Resolve-Path -LiteralPath $StagingFolder).Path "$stem.dem"
if ("$staged.json".Length -ge 240) { throw "Staging path too long for CS2: $staged" }
if ((Join-Path $output '1-sequence\video.mp4').Length -ge 240) { throw "Output folder path too long for HLAE: $output" }

Write-Host "Building sequence..."
$config = Join-Path $work 'video-config.json'
$builder = Join-Path $PSScriptRoot 'build-video-config.js'
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  # cs-demo-manager.exe is a GUI-subsystem program: PowerShell only waits for it (and sets $LASTEXITCODE)
  # when its output is piped.
  $builderArgs = @($builder, $matchJson, '--demo', $staged, '--output', $output, '--out', $config,
    '--encoder', $Encoder, '--width', $Width, '--height', $Height, '--framerate', $Framerate)
  if ($Rounds) { $builderArgs += @('--rounds', $Rounds) }
  if ($MaxSeconds -gt 0) { $builderArgs += @('--max-seconds', $MaxSeconds) }
  & $runtime @builderArgs 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "build-video-config.js failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

if ($DryRun) {
  Write-Host "Dry run, config written to $config"
  return
}

if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
try {
  New-Item -ItemType HardLink -Path $staged -Target $demo | Out-Null
} catch {
  Copy-Item -LiteralPath $demo -Destination $staged
}

$sequence = (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).sequences[0]
$tickrate = [math]::Round((Get-Content -LiteralPath $matchJson -Raw | ConvertFrom-Json).tickrate)
$footageMinutes = ($sequence.endTick - $sequence.startTick) / $tickrate / 60
$deadline = (Get-Date).AddMinutes(3 * $footageMinutes + 15)
$startDeadline = (Get-Date).AddMinutes($StartTimeoutMinutes)
$sequenceFolder = Join-Path $output '1-sequence' # created by HLAE when recording starts
$log = Join-Path $work 'csdm-video.log'

$startedAt = Get-Date
Write-Host "Recording..."
$failure = $null
try {
  $proc = Start-Process -FilePath $env:ComSpec -WindowStyle Hidden -PassThru `
    -ArgumentList "/s /c `"`"$csdm`" video --config-file `"$config`" > `"$log`" 2>&1`""
  $printed = 0
  $recordingSeen = $false
  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 5
    if (Test-Path -LiteralPath $log) {
      $lines = @(Get-Content -LiteralPath $log)
      $lines | Select-Object -Skip $printed | ForEach-Object { Write-Host $_ }
      $printed = $lines.Count
    }
    if (-not $recordingSeen -and (Test-Path -LiteralPath $sequenceFolder)) { $recordingSeen = $true }
    if (-not $recordingSeen -and (Get-Date) -gt $startDeadline) {
      $failure = "Recording did not start within $StartTimeoutMinutes minutes (demo from an older CS2 version, actions file not loaded, or map download stuck)"
    } elseif ((Get-Date) -gt $deadline) {
      $failure = 'Recording took more than three times the footage length'
    }
    if ($failure) {
      Get-Process cs2 -ErrorAction SilentlyContinue | Stop-Process -Force
      $proc.WaitForExit(120000) | Out-Null
      break
    }
  }
  if (Test-Path -LiteralPath $log) {
    Get-Content -LiteralPath $log | Select-Object -Skip $printed | ForEach-Object { Write-Host $_ }
  }
} finally {
  Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
}
if ($failure) { throw $failure }

$video = Get-ChildItem -LiteralPath $output -File -Filter '*.mp4' |
  Where-Object { $_.LastWriteTime -ge $startedAt -and $_.Length -gt 0 } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $video) { throw "No video was produced in $output (log: $log)" }

Remove-Item -LiteralPath $work -Recurse -Force
Write-Host "Video: $($video.FullName) ($([math]::Round($video.Length / 1MB, 1)) MB, $([int]((Get-Date) - $startedAt).TotalSeconds) s)"
