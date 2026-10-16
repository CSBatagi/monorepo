import { redirect } from 'next/navigation';

// Keep existing bookmarks and interface links pointed at the match detail view.
export default async function SonMacPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const incoming = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === 'string') params.set(key, value);
  }
  params.set('gorunum', 'maclar');
  redirect('/gece-ortalama?' + params);
}
