import { Award, Coins, Map, Star, type LucideIcon } from 'lucide-react';

/**
 * Önceki sezon formatları. Güncel sezon (Batak Mundial) dışındaki formatlar
 * ana sayfalardan kaldırıldı; sayfaları çalışmaya devam eder ve /arsiv
 * sayfasından erişilir.
 */
export const ACTIVE_SEASON = { href: '/mundial', label: 'Batak Mundial' } as const;
export const ARCHIVE_HREF = '/arsiv';

export const archivedFormats: { href: string; label: string; period?: string; desc: string; icon: LucideIcon }[] = [
  { href: '/superliga', label: 'Superliga', period: 'Haziran – Eylül 2026', desc: 'Puan bazlı tek liste lig. Mundial torbaları bu sezonun sıralamasından çıktı.', icon: Award },
  { href: '/token-wars', label: 'Batak Token Wars', period: 'Nisan 2026 sezonu', desc: 'Saldırı, savunma ve koruma tokenlarıyla oynanan sezon.', icon: Coins },
  { href: '/batak-allstars', label: 'Batak All-Stars', period: 'Ocak – Nisan 2026', desc: 'Lig puanı, token tablosu ve Super Kupa.', icon: Star },
  { href: '/batak-domination', label: 'Batak Domination', desc: 'Domination haritası.', icon: Map },
];

export function findArchivedFormat(pathname: string | null | undefined) {
  return archivedFormats.find((f) => f.href === pathname) || null;
}
