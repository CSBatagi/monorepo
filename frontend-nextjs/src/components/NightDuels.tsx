'use client';

import { useState } from 'react';
import Link from 'next/link';
import { sumMatchDuels, type MatchDuels } from '@/lib/matchDuels';
import HorizontalTableScroll from './HorizontalTableScroll';

export function DuelMatrix({ data, label }: { data: MatchDuels; label: string }) {
  const [focus, setFocus] = useState('');
  const selected = data.players.some(p => p.steam_id === focus) ? focus : '';
  const players = [...data.players].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  if (!players.length) return <p className="night-empty">Bu seçimde düello kaydı yok.</p>;
  return <div className="night-duels">
    <div className="duel-toolbar">
      <div><h3>{label}</h3><p>Satırdaki oyuncunun sütundaki rakibe karşı öldürme / ölüm sayısı.</p></div>
      <label>Oyuncuya odaklan<select value={selected} onChange={event => setFocus(event.target.value)}><option value="">Tüm oyuncular</option>{players.map(p => <option key={p.steam_id} value={p.steam_id}>{p.name}</option>)}</select></label>
    </div>
    <div className="duel-legend"><span className="duel-ahead">Önde</span><span className="duel-even">Berabere</span><span className="duel-behind">Geride</span></div>
    <HorizontalTableScroll label={label}>
      <table className="duel-matrix">
        <caption className="sr-only">{label}. Her hücre satırdaki oyuncunun sütundaki oyuncuya karşı öldürme ve ölüm toplamıdır.</caption>
        <thead><tr><th scope="col">Oyuncu / Rakip</th>{players.map(p => <th scope="col" key={p.steam_id}>{p.name}</th>)}</tr></thead>
        <tbody>{players.filter(p => !selected || p.steam_id === selected).map(player => <tr key={player.steam_id}><th scope="row">{player.name}</th>{players.map(opponent => {
          if (player.steam_id === opponent.steam_id) return <td key={opponent.steam_id} className="duel-self" aria-label="Kendisi">—</td>;
          const kills = data.kills[player.steam_id]?.[opponent.steam_id] || 0;
          const deaths = data.kills[opponent.steam_id]?.[player.steam_id] || 0;
          const state = kills > deaths ? 'ahead' : kills < deaths ? 'behind' : 'even';
          return <td key={opponent.steam_id}><span className={`duel-value duel-${state}`} aria-label={`${player.name}, ${opponent.name} karşısında ${kills} öldürme, ${deaths} ölüm`}><b>{kills}</b><span aria-hidden="true"> / </span>{deaths}</span></td>;
        })}</tr>)}</tbody>
      </table>
    </HorizontalTableScroll>
    <p className="night-table-note">Rakamlar seçili kapsamın toplamıdır. 0 / 0: aralarında kayıtlı öldürme yok. Kendine karşı ölümler dahil değildir.</p>
  </div>;
}

export default function NightDuels({ maps, scope, onScopeChange }: {
  maps: Record<string, any>; scope: string; onScopeChange: (scope: string) => void;
}) {
  const entries = Object.entries(maps);
  const activeScope = entries.some(([key]) => key === scope) ? scope : '';
  const available = entries.filter(([, map]) => map.duels && Array.isArray(map.duels.players));
  // Never present a partial night as a complete total during rollout or on old snapshots.
  const complete = entries.length > 0 && available.length === entries.length;
  const data: MatchDuels | undefined = activeScope ? maps[activeScope].duels : complete ? sumMatchDuels(available.map(([, map]) => map.duels)) : undefined;
  return <>
    <div className="night-map-tabs duel-scope-tabs" role="group" aria-label="Düello kapsamı">
      <button type="button" aria-pressed={!activeScope} onClick={() => onScopeChange('')}>Gece Toplamı<span>{entries.length} harita</span></button>
      {entries.map(([key, map]) => <button type="button" key={key} aria-pressed={activeScope === key} onClick={() => onScopeChange(key)}>{key.replace(/^de_/, '')}<span>{map.team1?.score ?? '—'} : {map.team2?.score ?? '—'}</span></button>)}
    </div>
    {data ? <DuelMatrix data={data} label={activeScope ? `${activeScope.replace(/^de_/, '')} · Düellolar` : 'Gecenin düello toplamları'} /> : <p className="night-empty" role="status">{entries.length ? 'Bu seçim için düello verisi henüz hazır değil.' : 'Bu gece için harita kaydı yok.'}</p>}
    <Link className="duel-season-link" prefetch={false} href="/duello">Sezonun düello toplamlarına git →</Link>
  </>;
}
