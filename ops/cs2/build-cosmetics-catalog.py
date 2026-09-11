"""Normalize a pinned ByMykel/CSGO-API checkout/download for our allowlisted catalog."""
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(__file__).resolve().parents[2] / 'backend' / 'data' / 'cosmetics-catalog.json'
items = []
for filename, kind in [('skins', None), ('agents', 'agent'), ('stickers', 'sticker'), ('keychains', 'charm'), ('music_kits', 'music')]:
    for raw in json.loads((source / (filename + '.json')).read_text(encoding='utf-8-sig')):
        category = raw.get('category', {}).get('id', '')
        item_kind = kind or ('glove' if 'gloves' in category else 'knife' if 'melee' in category else 'weapon')
        definition = int(raw['weapon']['weapon_id'] if kind is None else raw['def_index'])
        if definition <= 0 or definition > 65535:
            continue
        items.append(dict(id=raw['id'], name=raw['name'], kind=item_kind, defindex=definition,
            weapon=raw.get('weapon', {}).get('name', ''), paint=int(raw.get('paint_index') or 0),
            minWear=raw.get('min_float') or 0, maxWear=raw.get('max_float') if raw.get('max_float') is not None else 1,
            teams=[2] if raw.get('team', {}).get('id') == 'terrorists' else [3] if raw.get('team', {}).get('id') == 'counter-terrorists' else [2, 3],
            image=raw.get('image'), color=raw.get('rarity', {}).get('color', '#94a3b8')))
assert len({item['id'] for item in items}) == len(items)
assert all(sum(x['kind'] == kind for x in items) > 0 for kind in ['weapon', 'knife', 'glove', 'agent', 'sticker', 'charm', 'music'])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(dict(source='https://github.com/ByMykel/CSGO-API', revision=(source / 'commit.txt').read_text(encoding='utf-8-sig').strip(), items=items), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'{len(items)} catalog items; {target.stat().st_size} bytes')
