import Link from 'next/link';
import { Archive, ArrowRight } from 'lucide-react';
import { ACTIVE_SEASON, ARCHIVE_HREF } from '@/lib/archivedFormats';

/** Shown on archived format pages; the active season lives at ACTIVE_SEASON. */
export default function ArchivedFormatBanner() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
      <span className="inline-flex items-center gap-1.5 font-medium"><Archive className="h-4 w-4 text-gray-500" />Bu format arşivde.</span>
      <Link prefetch={false} href={ACTIVE_SEASON.href} className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
        Güncel sezon: {ACTIVE_SEASON.label} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
      <Link prefetch={false} href={ARCHIVE_HREF} className="text-gray-500 hover:underline">Tüm arşiv</Link>
    </div>
  );
}
