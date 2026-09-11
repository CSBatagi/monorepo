const { byId } = require('./cosmetics');

// Club tiers, not market prices. Reserve entire pattern-variable finishes so a
// freely chosen seed cannot turn a regular unlock into a premium variant.
const TIERS = {
  starter: { tier: 'starter', label: 'Başlangıç', level: 1, cost: 0, currency: 'tokens' },
  club: { tier: 'club', label: 'Kulüp', level: 1, cost: 20, currency: 'tokens' },
  rare: { tier: 'rare', label: 'Nadir', level: 3, cost: 60, currency: 'tokens' },
  elite: { tier: 'elite', label: 'Seçkin', level: 5, cost: 120, currency: 'tokens' },
  premium: { tier: 'premium', label: 'Premium', level: 1, cost: 1, currency: 'premiumTokens' },
};
function itemAccess(item) {
  if (/Dragon Lore|Gungnir|Wild Lotus|\bHowl\b|Pandora's Box|\bVice\b|Superconductor|Doppler|\bFade\b|Case Hardened|Katowice 2014|Crown \(Foil\)|Howling Dawn/i.test(item.name)) return TIERS.premium;
  if (['knife', 'glove'].includes(item.kind)) return TIERS.elite;
  if (item.kind === 'music' || item.kind === 'charm') return TIERS.club;
  if (item.kind === 'agent') return TIERS.rare;
  return ({ '#eb4b4b': TIERS.elite, '#e4ae39': TIERS.elite, '#d32ce6': TIERS.rare, '#8847ff': TIERS.club })[item.color.toLowerCase()] || TIERS.starter;
}
const levelFor = xp => 1 + Math.floor(Number(xp) / 300);
function progressView(wallet, unlocks) {
  const xp = Number(wallet.xp);
  return { xp, level: levelFor(xp), levelXp: xp % 300, nextLevelXp: 300,
    tokens: Number(wallet.tokens), premiumTokens: Number(wallet.premium_tokens),
    matches: Number(wallet.matches), nights: Number(wallet.nights), unlocks: [...unlocks] };
}
function owns(id, unlocks) {
  const item = byId.get(id);
  return !!item && (itemAccess(item).cost === 0 || unlocks.has(id));
}
function selectionIds(state) {
  return [...new Set(state.profiles.flatMap(p => p.items.flatMap(i => [i.id, ...(i.stickers || []), i.charm])).filter(Boolean))];
}
function assertOwnership(state, unlocks) {
  if (selectionIds(state).some(id => !owns(id, unlocks))) {
    const error = new Error('Önce seçtiğiniz eşyanın, çıkartmanın veya uğurluğun kilidini açın.');
    error.status = 403; throw error;
  }
}
function ownedState(state, unlocks) {
  return { ...state, profiles: state.profiles.map(p => ({ ...p, items: p.items.filter(i => owns(i.id, unlocks)).map(i => ({ ...i,
    ...(i.stickers ? { stickers: i.stickers.map(id => id && owns(id, unlocks) ? id : null), charm: i.charm && owns(i.charm, unlocks) ? i.charm : null } : {})
  })) })) };
}
module.exports = { TIERS, itemAccess, levelFor, progressView, owns, selectionIds, assertOwnership, ownedState };
