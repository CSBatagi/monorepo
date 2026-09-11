"""Checked adapter for the pinned Inventory Simulator and installed .NET 10 runtime."""
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
def replace(file, old, new):
    path = root / file
    text = path.read_text(encoding='utf-8-sig')
    if new in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f'Upstream changed: {file}: {old}')
    path.write_text(text.replace(old, new), encoding='utf-8')

replace('source/InventorySimulator/Services/Api.cs', 'var response = await _httpClient.GetAsync(url);', 'using var response = await CSBatagiInventoryApi.GetAsync(url);')
replace('source/InventorySimulator/Services/ConVars.cs', '"https://inventory.cstrike.app"', '"https://csbatagi.com/backend/cosmetics"')
replace('source/InventorySimulator/InventorySimulator.cs', 'Runtime.Initialize(this);', 'Runtime.Initialize(this);\n        CSBatagiInventoryApi.Initialize();')
