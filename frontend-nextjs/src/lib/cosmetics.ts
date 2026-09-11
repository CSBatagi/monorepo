export type CosmeticKind = 'weapon' | 'knife' | 'glove' | 'agent' | 'music' | 'sticker' | 'charm';
export type CosmeticItem = { id: string; name: string; kind: CosmeticKind; defindex: number; weapon: string; paint: number; minWear: number; maxWear: number; teams: number[]; image: string | null; color: string };
export type CosmeticSelection = { id: string; team: number; wear?: number; seed?: number; nametag?: string; stattrak?: boolean; stickers?: (string | null)[]; charm?: string | null };
export type CosmeticState = { active: number; profiles: { name: string; items: CosmeticSelection[] }[] };
export type CosmeticAccount = { steamId: string | null; state: CosmeticState; revision: number; lastFetchedAt: string | null; items: CosmeticItem[] };
export const cosmeticKinds: { id: CosmeticKind; label: string }[] = [{ id: 'weapon', label: 'Silahlar' }, { id: 'knife', label: 'Bıçaklar' }, { id: 'glove', label: 'Eldivenler' }, { id: 'agent', label: 'Ajanlar' }, { id: 'music', label: 'Müzik' }];
export function selectionFor(item: CosmeticItem, team: number): CosmeticSelection {
  return { id: item.id, team, ...(['weapon', 'knife', 'glove'].includes(item.kind) ? { wear: Math.max(item.minWear, Math.min(0.01, item.maxWear)), seed: 1 } : {}),
    ...(['weapon', 'knife'].includes(item.kind) ? { nametag: '', stattrak: false } : {}), ...(item.kind === 'weapon' ? { stickers: [null, null, null, null, null], charm: null } : {}) };
}
