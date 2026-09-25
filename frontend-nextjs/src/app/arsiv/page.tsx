import Link from 'next/link';
import { ArrowUpRight, Trophy } from 'lucide-react';
import { ACTIVE_SEASON, archivedFormats } from '@/lib/archivedFormats';

export default function ArchivePage() {
  return (
    <div id="page-arsiv" className="page-content page-content-container">
      <h2 className="text-2xl font-semibold text-blue-600 mb-2">Arşiv</h2>
      <p className="mb-6 text-sm text-gray-600">
        Önceki sezonların formatları. Tablolar, puanlar ve kupalar olduğu gibi duruyor.
      </p>

      <Link
        prefetch={false}
        href={ACTIVE_SEASON.href}
        className="mb-6 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors hover:border-blue-500"
      >
        <Trophy className="h-8 w-8 shrink-0 text-yellow-500" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Güncel sezon</span>
          <span className="block text-lg font-bold text-gray-800">{ACTIVE_SEASON.label}</span>
        </span>
        <ArrowUpRight className="h-5 w-5 text-gray-500" />
      </Link>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {archivedFormats.map(({ href, label, period, desc, icon: Icon }) => (
          <Link
            prefetch={false}
            key={href}
            href={href}
            className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-blue-500"
          >
            <Icon className="mt-0.5 h-8 w-8 shrink-0 text-blue-600" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-gray-800">{label}</span>
              {period && <span className="block text-xs font-medium text-gray-500">{period}</span>}
              <span className="mt-1 block text-sm text-gray-600">{desc}</span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-blue-600" />
          </Link>
        ))}
      </div>
    </div>
  );
}
