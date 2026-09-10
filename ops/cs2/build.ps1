param([string]$Source, [string]$Dotnet = 'dotnet', [string]$Output)
$ErrorActionPreference = 'Stop'
$pin = '7641c7a005318d7580ec8bf69de1b8f957c4cef7'
if ((git -C $Source rev-parse HEAD).Trim() -ne $pin) { throw 'Unexpected MatchZy source revision' }
Copy-Item -LiteralPath "$PSScriptRoot/CSBatagi.cs" -Destination "$Source/src/CSBatagi.cs"
python "$PSScriptRoot/patch-matchzy.py" $Source
if ($LASTEXITCODE -ne 0) { throw 'MatchZy source patch failed' }
& $Dotnet publish "$Source/MatchZy.csproj" -c Release -o $Output
if ($LASTEXITCODE -ne 0) { throw 'MatchZy build failed' }
