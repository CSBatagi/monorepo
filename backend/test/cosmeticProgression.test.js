const { catalog, validateState } = require('../cosmetics');
const { itemAccess, owns, ownedState, assertOwnership, levelFor } = require('../cosmeticProgression');

test('premium finishes include every seed and Doppler phase, while regular knives remain earnable', () => {
  for (const name of ['Dragon Lore', 'Gungnir', 'Wild Lotus', 'Howl', "Pandora's Box", 'Doppler', 'Case Hardened', 'Katowice 2014']) {
    const matches = catalog.items.filter(i => i.name.includes(name));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every(i => itemAccess(i).currency === 'premiumTokens')).toBe(true);
  }
  expect(catalog.items.some(i => i.kind === 'knife' && itemAccess(i).tier === 'elite')).toBe(true);
  expect(catalog.items.filter(i => i.kind === 'weapon' && itemAccess(i).cost === 0).length).toBeGreaterThan(100);
});
test('levels are predictable and cannot consume experience when buying items', () => {
  expect([0, 299, 300, 599, 600, 1200].map(levelFor)).toEqual([1, 1, 2, 2, 3, 5]);
});
test('legacy state and forged attachments cannot bypass ownership in any profile', () => {
  const weapon = catalog.items.find(i => i.kind === 'weapon' && itemAccess(i).cost === 0);
  const premium = catalog.items.find(i => i.kind === 'weapon' && itemAccess(i).tier === 'premium');
  const sticker = catalog.items.find(i => i.kind === 'sticker' && itemAccess(i).tier === 'premium');
  const charm = catalog.items.find(i => i.kind === 'charm');
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
