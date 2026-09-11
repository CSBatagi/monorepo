param([Parameter(Mandatory)][string]$Source, [string]$Dotnet = 'dotnet', [Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$pin = '5e3c96283b3d3f5aeba44822a38031df2e213376'
if ((git -C $Source rev-parse HEAD).Trim() -ne $pin) { throw 'Unexpected Inventory Simulator revision' }
Copy-Item -LiteralPath "$PSScriptRoot/CSBatagiInventory.cs" -Destination "$Source/source/InventorySimulator/CSBatagiInventory.cs"
python "$PSScriptRoot/patch-inventory.py" $Source
if ($LASTEXITCODE -ne 0) { throw 'Inventory patch failed' }
& $Dotnet publish "$Source/InventorySimulator.csproj" -c Release -o "$Output/plugins/InventorySimulator"
if ($LASTEXITCODE -ne 0) { throw 'Inventory build failed' }
New-Item -ItemType Directory -Force "$Output/gamedata" | Out-Null
Copy-Item -LiteralPath "$Source/gamedata/inventory-simulator.json" -Destination "$Output/gamedata/inventory-simulator.json"
Copy-Item -LiteralPath "$Source/License.txt" -Destination "$Output/plugins/InventorySimulator/License.txt"
New-Item -ItemType Directory -Force "$Output/plugins/InventorySimulator/lang" | Out-Null
Copy-Item -Path "$Source/source/InventorySimulator/lang/*" -Destination "$Output/plugins/InventorySimulator/lang" -Force
