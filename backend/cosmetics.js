const crypto = require('crypto');
const catalog = require('./data/cosmetics-catalog.json');
const byId = new Map(catalog.items.map(item => [item.id, item]));
const equipment = new Set(['weapon', 'knife', 'glove', 'agent', 'music']);
const emptyState = () => ({ active: 0, profiles: [{ name: 'Ana ekipman', items: [] }] });

function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
function finite(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function validateState(input) {
  if (!input || !Array.isArray(input.profiles) || input.profiles.length < 1 || input.profiles.length > 3 || !integer(input.active, 0, input.profiles.length - 1)) throw new Error('En fazla üç ekipman seti seçin.');
  return { active: input.active, profiles: input.profiles.map(profile => {
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 40 || !Array.isArray(profile.items) || profile.items.length > 90) throw new Error('Geçersiz ekipman seti.');
    const slots = new Set();
    return { name: profile.name.trim(), items: profile.items.map(selection => {
      const item = byId.get(selection?.id);
      if (!item || !equipment.has(item.kind) || !item.teams.includes(selection.team)) throw new Error('Bu eşya seçilen takım için kullanılamaz.');
      const slot = `${item.kind === 'music' ? 0 : selection.team}:${item.kind}:${item.kind === 'weapon' ? item.defindex : 0}`;
      if (slots.has(slot)) throw new Error('Aynı ekipman yuvasına iki eşya seçilemez.');
      slots.add(slot);
      const result = { id: item.id, team: selection.team };
      if (['weapon', 'knife', 'glove'].includes(item.kind)) {
        if (!finite(selection.wear, item.minWear, item.maxWear) || !integer(selection.seed, 0, 1000)) throw new Error('Float veya desen aralık dışında.');
        Object.assign(result, { wear: selection.wear, seed: selection.seed });
      }
      if (['weapon', 'knife'].includes(item.kind)) {
        if (typeof selection.stattrak !== 'boolean' || typeof selection.nametag !== 'string' || selection.nametag.length > 20 || /[\x00-\x1f\x7f]/.test(selection.nametag)) throw new Error('Geçersiz isim etiketi veya StatTrak.');
        Object.assign(result, { stattrak: selection.stattrak, nametag: selection.nametag });
      }
      if (item.kind === 'weapon') {
        if (!Array.isArray(selection.stickers) || selection.stickers.length !== 5 || selection.stickers.some(id => id !== null && byId.get(id)?.kind !== 'sticker')) throw new Error('Beş geçerli çıkartma yuvası gerekir.');
        if (selection.charm !== null && byId.get(selection.charm)?.kind !== 'charm') throw new Error('Geçersiz uğurluk.');
        Object.assign(result, { stickers: selection.stickers, charm: selection.charm });
      }
      return result;
    }) };
  }) };
}

function equipped(state) {
  const result = { agents: {}, ctWeapons: {}, gloves: {}, knives: {}, tWeapons: {} };
  for (const [index, selection] of (state.profiles[state.active]?.items || []).entries()) {
    const item = byId.get(selection.id);
    if (!item) continue;
    const value = { uid: index + 1, def: item.defindex, paint: item.paint, wear: selection.wear, seed: selection.seed,
      nametag: selection.nametag, stattrak: selection.stattrak ? 0 : null, stickers: [], keychains: [] };
    for (const [slot, id] of (selection.stickers || []).entries()) if (id) value.stickers.push({ slot, def: byId.get(id).defindex, wear: 0 });
    if (selection.charm) value.keychains.push({ slot: 0, def: byId.get(selection.charm).defindex, seed: 1 });
    if (item.kind === 'music') { value.def = 1314; value.musicId = item.defindex; }
    value.hash = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    if (item.kind === 'weapon') result[selection.team === 2 ? 'tWeapons' : 'ctWeapons'][item.defindex] = value;
    else if (item.kind === 'music') result.musicKit = value;
    else result[{ knife: 'knives', glove: 'gloves', agent: 'agents' }[item.kind]][selection.team] = value;
  }
  return result;
}
module.exports = { catalog, byId, emptyState, validateState, equipped };
