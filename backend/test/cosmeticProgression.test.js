const { catalog, validateState } = require('../cosmetics');
const { PREMIUM, PREMIUM_FINISHES, ENTRY_FINISHES, SIGNATURE_MUSIC, baseName, itemAccess, owns, ownedState, assertOwnership, levelFor } = require('../cosmeticProgression');
const tier = name => catalog.items.filter(i => i.name === name).map(i => itemAccess(i).tier);

test('premium finishes include every seed and Doppler phase, while regular knives remain earnable', () => {
  for (const name of ['AWP | Dragon Lore', 'AWP | Gungnir', 'AK-47 | Wild Lotus', 'M4A4 | Howl', "★ Sport Gloves | Pandora's Box", '★ Karambit | Doppler', '★ Karambit | Gamma Doppler', '★ Butterfly Knife | Fade', 'AK-47 | Case Hardened', 'Sticker | iBUYPOWER (Holo) | Katowice 2014']) {
    expect(tier(name).length).toBeGreaterThan(0);
    expect(tier(name).every(t => t === 'premium')).toBe(true);
  }
  expect(tier('★ Karambit | Doppler').length).toBeGreaterThan(1);
  expect(catalog.items.some(i => i.kind === 'knife' && itemAccess(i).tier === 'elite')).toBe(true);
  expect(catalog.items.filter(i => i.kind === 'weapon' && itemAccess(i).cost === 0).length).toBeGreaterThan(100);
});
test('named reserves match the catalog, and cheap namesakes are not premium', () => {
  const names = new Set(catalog.items.map(i => `${i.kind}:${baseName(i)}`));
  const finishes = new Set(catalog.items.map(i => `${i.kind}:${baseName(i).split(' | ').at(-1)}`));
  for (const [kind, list] of Object.entries(PREMIUM)) for (const name of list) expect(names).toContain(`${kind}:${name}`);
  for (const name of SIGNATURE_MUSIC) expect(names).toContain(`music:${name}`);
  for (const lists of [PREMIUM_FINISHES, ENTRY_FINISHES]) for (const [kind, list] of Object.entries(lists)) for (const name of list) expect(finishes).toContain(`${kind}:${name}`);
  for (const name of ['AUG | Amber Fade', 'SSG 08 | Acid Fade', 'MP9 | Pandora\'s Box', 'MAC-10 | Case Hardened', 'Sticker | vice | London 2018', 'Sticker | Fade Lethal']) {
    expect(tier(name).length).toBeGreaterThan(0);
    expect(tier(name)).not.toContain('premium');
  }
});
test('every equipment category offers an entry tier through premium', () => {
  const tiers = (kind, team) => new Set(catalog.items.filter(i => i.kind === kind && (!team || i.teams.includes(team))).map(i => itemAccess(i).tier));
  const all = ['starter', 'club', 'rare', 'elite', 'premium'];
  for (const kind of ['weapon', 'music', 'charm', 'sticker']) expect([...tiers(kind)].sort()).toEqual([...all].sort());
  for (const team of [2, 3]) expect([...tiers('agent', team)].sort()).toEqual([...all].sort());
  for (const kind of ['knife', 'glove']) expect([...tiers(kind)].sort()).toEqual(['elite', 'premium', 'rare']);
  expect(tier('Valve, Counter-Strike 2')).toEqual(['starter']);
  expect(tier('Music Kit | Noisia, Sharpened')).toEqual(['elite']);
  expect(tier('Music Kit | Daniel Sadowski, Crimson Assault')).toEqual(['club']);
  expect(tier('StatTrak™ Music Kit | Daniel Sadowski, Crimson Assault')).toEqual(['rare']);
  // Reserving a kit reserves its StatTrak copy too; both play the same song.
  expect(tier('Music Kit | The Verkkars, EZ4ENCE')).toEqual(['premium']);
  expect(tier('StatTrak™ Music Kit | The Verkkars, EZ4ENCE')).toEqual(['premium']);
  expect(tier('★ Karambit | Safari Mesh')).toEqual(['rare']);
  expect(tier('★ Karambit')).toEqual(['elite']);
});
test('levels are predictable and cannot consume experience when buying items', () => {
  expect([0, 299, 300, 599, 600, 1200].map(levelFor)).toEqual([1, 1, 2, 2, 3, 5]);
});
test('legacy state and forged attachments cannot bypass ownership in any profile', () => {
  const weapon = catalog.items.find(i => i.kind === 'weapon' && itemAccess(i).cost === 0);
  const premium = catalog.items.find(i => i.kind === 'weapon' && itemAccess(i).tier === 'premium');
  const sticker = catalog.items.find(i => i.kind === 'sticker' && itemAccess(i).tier === 'premium');
  const charm = catalog.items.find(i => i.kind === 'charm' && itemAccess(i).cost > 0);
  const select = item => ({ id: item.id, team: 2, wear: item.minWear, seed: 661, nametag: '', stattrak: false, stickers: [sticker.id, null, null, null, null], charm: charm.id });
  const state = validateState({ active: 0, profiles: [{ name: 'Free', items: [select(weapon)] }, { name: 'Hidden premium', items: [select(premium)] }] });
  expect(() => assertOwnership(state, new Set())).toThrow();
  const filtered = ownedState(state, new Set());
  expect(filtered.profiles[0].items[0].stickers).toEqual([null, null, null, null, null]);
  expect(filtered.profiles[0].items[0].charm).toBeNull();
  expect(filtered.profiles[1].items).toEqual([]);
  const unlocks = new Set([premium.id, sticker.id, charm.id]);
  expect(() => assertOwnership(state, unlocks)).not.toThrow();
  expect(ownedState(state, unlocks)).toEqual(state);
  expect(owns('forged-id', unlocks)).toBe(false);
});
