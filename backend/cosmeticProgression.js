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
const RARITY = { '#eb4b4b': TIERS.elite, '#e4ae39': TIERS.elite, '#d32ce6': TIERS.rare, '#8847ff': TIERS.club };
// Reserves use catalog names without the ★ / Music Kit / Charm / Sticker prefix, per kind,
// so a cheap item that merely shares a word (Amber Fade, a "vice" autograph) stays regular.
// Music reserves cover the whole kit: the StatTrak variant plays the same song.
const PREMIUM = {
  weapon: ['AWP | Dragon Lore', 'AWP | Gungnir', 'AWP | Medusa', 'AWP | The Prince', 'AWP | Desert Hydra', 'AWP | Fade',
    'AK-47 | Wild Lotus', 'AK-47 | Fire Serpent', 'AK-47 | Gold Arabesque', 'AK-47 | Case Hardened', 'M4A4 | Howl', 'M4A4 | Poseidon',
    'M4A1-S | Welcome to the Jungle', 'M4A1-S | Knight', 'M4A1-S | Fade', 'Glock-18 | Fade', 'Glock-18 | Gamma Doppler', 'Desert Eagle | Blaze'],
  glove: ["Sport Gloves | Pandora's Box", 'Sport Gloves | Vice', 'Sport Gloves | Superconductor', 'Sport Gloves | Hedge Maze',
    'Specialist Gloves | Fade', 'Specialist Gloves | Marble Fade', 'Specialist Gloves | Crimson Kimono', 'Specialist Gloves | Emerald Web',
    'Hydra Gloves | Case Hardened', 'Moto Gloves | Spearmint', 'Driver Gloves | King Snake'],
  agent: ["'The Doctor' Romanov | Sabre", 'Sir Bloody Miami Darryl | The Professionals', 'Vypa Sista of the Revolution | Guerrilla Warfare',
    'Special Agent Ava | FBI', "Cmdr. Frank 'Wet Sox' Baroud | SEAL Frogman", "Cmdr. Mae 'Dead Cold' Jamison | SWAT"],
  music: ['The Verkkars, EZ4ENCE', 'The Verkkars & n0thing, Flashbang Dance', 'Various Artists, Hotline Miami',
    '3kliksphilip, Heading for the Source', 'Daniel Sadowski, The 8-Bit Kit'],
  charm: ['Hot Howl', 'Baby Karat T', 'Baby Karat CT'],
  sticker: ['Crown (Foil)', 'Howling Dawn'],
};
// Whole finish families (every Doppler phase and seed) or sticker events.
const PREMIUM_FINISHES = { knife: ['Fade', 'Doppler', 'Gamma Doppler', 'Marble Fade', 'Case Hardened'], sticker: ['Katowice 2014'] };
// Entry knives and gloves: camouflage and utility finishes start at Nadir; everything else is Seçkin.
const ENTRY_FINISHES = {
  knife: ['Safari Mesh', 'Boreal Forest', 'Scorched', 'Urban Masked', 'Forest DDPAT', 'Night Stripe', 'Rust Coat'],
  glove: ['Spruce DDPAT', 'Desert Shamagh', 'Badlands', 'Leather', 'Arboreal', 'Giraffe', 'Duct Tape', 'Eclipse', 'Turtle', 'Transport',
    '3rd Commando Company', 'Convoy', 'Racing Green', 'Rezan the Red', 'Forest DDPAT', 'Buckshot', 'Arid', 'Bronze Morph', 'Charred',
    'Guerrilla', 'Bronzed', 'Needle Point', 'Unhinged', 'Yellow-banded', 'Mangrove', 'Rattler'],
};
const SIGNATURE_MUSIC = ['Noisia, Sharpened', 'Feed Me, High Noon', 'Kelly Bailey, Hazardous Environments', 'AWOLNATION, I Am',
  'Darude, Moments CS:GO', 'Scarlxrd: King, Scar', 'bbno$, u mad!', 'Denzel Curry, ULTIMATE'];
const sets = lists => Object.fromEntries(Object.entries(lists).map(([kind, names]) => [kind, new Set(names)]));
const premiumNames = sets(PREMIUM), premiumFinishes = sets(PREMIUM_FINISHES), entryFinishes = sets(ENTRY_FINISHES), signatureMusic = new Set(SIGNATURE_MUSIC);
const MUSIC_PREFIX = /^(StatTrak™ )?Music Kit \| /;
const baseName = item => item.name.replace(/^★ /, '').replace(MUSIC_PREFIX, '').replace(/^(Charm|Sticker) \| /, '');
const isStatTrakMusic = item => item.kind === 'music' && item.name.startsWith('StatTrak™ ');

function itemAccess(item) {
  const name = baseName(item), finish = name.split(' | ').at(-1);
  if (premiumNames[item.kind]?.has(name) || premiumFinishes[item.kind]?.has(finish)) return TIERS.premium;
  if (entryFinishes[item.kind]) return entryFinishes[item.kind].has(finish) ? TIERS.rare : TIERS.elite;
  if (item.kind === 'music') {
    // Default and promotional kits (Valve, Halo, Alyx, Hades) were never sold in boxes.
    if (!MUSIC_PREFIX.test(item.name)) return TIERS.starter;
    return signatureMusic.has(name) ? TIERS.elite : isStatTrakMusic(item) ? TIERS.rare : TIERS.club;
  }
  // Weapons, agents, stickers and charms follow in-game rarity: Mil-Spec/Distinguished and below are free.
  return RARITY[item.color.toLowerCase()] || TIERS.starter;
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
module.exports = { TIERS, PREMIUM, PREMIUM_FINISHES, ENTRY_FINISHES, SIGNATURE_MUSIC, baseName, itemAccess, levelFor, progressView, owns, selectionIds, assertOwnership, ownedState };
