'use client';

import { useEffect, useState } from 'react';
import { Crown, Trophy } from 'lucide-react';
import type { useSession } from '@/contexts/SessionContext';
import { deleteMundialKnockoutResult, setMundialKnockoutResult } from '@/lib/liveApi';
import type { BracketEntrant, BracketMatch, MundialKnockoutSlot } from '@/lib/mundial';
import { CLEAR_ATTENDANCE_PASSWORD, getErrorMessage } from '@/components/superliga/SuperligaPanels';
import styles from './mundial.module.css';

type SessionUser = ReturnType<typeof useSession>['user'];

function PlayerLine({
  entrant,
  placeholder,
  match,
  nameOf,
}: {
  entrant: BracketEntrant;
  placeholder: string;
  match: BracketMatch;
  nameOf: (steamId: string) => string;
}) {
  const decided = !!match.winnerSteamId;
  const won = decided && entrant?.steamId === match.winnerSteamId;
  return (
    <div className={`${styles.matchPlayer} ${won ? styles.matchWinner : decided ? styles.matchLoser : ''}`}>
      {entrant?.seed && <span className={styles.seed}>{entrant.seed}</span>}
      {entrant ? (
        <span className={styles.slotName}>{nameOf(entrant.steamId)}</span>
      ) : (
        <span className={styles.placeholder}>{placeholder}</span>
      )}
      {won && <Crown className="ml-auto h-4 w-4 shrink-0" />}
    </div>
  );
}

function MatchCard({
  match,
  nameOf,
  user,
  provisional,
  onChanged,
}: {
  match: BracketMatch;
  nameOf: (steamId: string) => string;
  user: SessionUser;
  provisional: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [winner, setWinner] = useState('');
  const [score, setScore] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWinner(match.result?.winnerSteamId || '');
    setScore(match.result?.score || '');
    setDate(match.result?.date || '');
  }, [match.result]);

  const p1 = match.player1;
  const p2 = match.player2;
  const canEdit = !!user && !!p1 && !!p2;

  const save = async () => {
    if (!p1 || !p2 || !user) return;
    if (!winner) { setError('Kazananı seçin.'); return; }
    const password = window.prompt(`${match.label} sonucunu kaydetmek için şifre girin:`);
    if (password === null) return;
    if (password !== CLEAR_ATTENDANCE_PASSWORD) { setError('Hatalı şifre.'); return; }
    setSaving(true);
    setError(null);
    try {
      await setMundialKnockoutResult({
        slot: match.slot,
        player1SteamId: p1.steamId,
        player2SteamId: p2.steamId,
        winnerSteamId: winner,
        score: score.trim() || undefined,
        date: date || undefined,
        setByUid: user.uid,
        setByName: user.name || user.email || '',
        setAt: Date.now(),
      });
      setEditing(false);
      await onChanged();
    } catch (e: unknown) {
      setError(`Hata: ${getErrorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const password = window.prompt(`${match.label} sonucunu silmek için şifre girin (sonraki turlar da silinir):`);
    if (password === null) return;
    if (password !== CLEAR_ATTENDANCE_PASSWORD) { setError('Hatalı şifre.'); return; }
    setSaving(true);
    try {
      await deleteMundialKnockoutResult({ slot: match.slot });
      setEditing(false);
      await onChanged();
    } catch (e: unknown) {
      setError(`Hata: ${getErrorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.match}>
      <div className={styles.matchLabel}>
        <span>{match.label}{match.result?.date ? ` · ${match.result.date}` : ''}</span>
        {match.result?.score ? <span className={styles.score}>{match.result.score}</span> : canEdit && !editing ? (
          <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>Sonuç gir</button>
        ) : null}
      </div>
      <PlayerLine entrant={p1} placeholder={match.placeholder1} match={match} nameOf={nameOf} />
      <PlayerLine entrant={p2} placeholder={match.placeholder2} match={match} nameOf={nameOf} />
      {match.result && canEdit && !editing && (
        <div className="flex justify-end px-2 pb-1">
          <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>Düzenle</button>
        </div>
      )}
      {editing && p1 && p2 && (
        <div className={styles.matchForm}>
          {provisional && <span className={styles.errorMessage}>Grup aşaması bitmedi; eşleşme şu anki sıralamaya göre.</span>}
          <select value={winner} onChange={(e) => setWinner(e.target.value)} aria-label="Kazanan">
            <option value="">Kazanan…</option>
            <option value={p1.steamId}>{nameOf(p1.steamId)}</option>
            <option value={p2.steamId}>{nameOf(p2.steamId)}</option>
          </select>
          <div className={styles.matchFormRow}>
            <input value={score} onChange={(e) => setScore(e.target.value)} placeholder="Skor (ör. 2-1)" aria-label="Skor" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Tarih" />
          </div>
          <div className={styles.matchFormRow}>
            <button type="button" className={styles.smallButton} onClick={save} disabled={saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
            <button type="button" className={styles.linkButton} onClick={() => { setEditing(false); setError(null); }}>Vazgeç</button>
            {match.result && <button type="button" className={`${styles.linkButton} ml-auto`} onClick={remove} disabled={saving}>Sil</button>}
          </div>
        </div>
      )}
      {error && <div className={`${styles.errorMessage} px-3 pb-2`}>{error}</div>}
    </div>
  );
}

export default function MundialBracket({
  matches,
  championSteamId,
  nameOf,
  user,
  groupStageComplete,
  seedsKnown,
  onChanged,
}: {
  matches: Record<MundialKnockoutSlot, BracketMatch>;
  championSteamId: string | null;
  nameOf: (steamId: string) => string;
  user: SessionUser;
  groupStageComplete: boolean;
  seedsKnown: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const card = (slot: MundialKnockoutSlot) => (
    <MatchCard key={slot} match={matches[slot]} nameOf={nameOf} user={user} provisional={!groupStageComplete} onChanged={onChanged} />
  );

  return (
    <div className="flex flex-col gap-4">
      <p className={styles.muted}>
        {groupStageComplete
          ? 'Grup aşaması tamamlandı. Eşleşmeler kesinleşti.'
          : seedsKnown
            ? 'Grup aşaması sürüyor — tablo "şu an bitseydi" durumunu gösterir.'
            : 'Grup aşaması başlayınca eşleşmeler burada görünür.'}
        {' '}Grup birincileri kendi grubunun ikincisiyle ancak finalde karşılaşabilir. Gruptan çıkan bir oyuncu en fazla 3 maç daha oynar.
      </p>
      <div className={styles.bracket}>
        <div className={styles.round}>
          <div className={styles.roundTitle}>ÇEYREK FİNAL</div>
          <div className={styles.roundMatches}>{(['qf1', 'qf2', 'qf3', 'qf4'] as const).map(card)}</div>
        </div>
        <div className={styles.round}>
          <div className={styles.roundTitle}>YARI FİNAL</div>
          <div className={styles.roundMatches}>{(['sf1', 'sf2'] as const).map(card)}</div>
        </div>
        <div className={styles.round}>
          <div className={styles.roundTitle}>FİNAL</div>
          <div className={styles.roundMatches}>{card('final')}</div>
        </div>
        <div className={styles.round}>
          <div className={styles.roundTitle}>ŞAMPİYON</div>
          <div className={styles.roundMatches}>
          <div className={`${styles.champion} ${championSteamId ? '' : styles.championEmpty}`}>
            <Trophy className="h-10 w-10" />
            {championSteamId ? (
              <>
                <div className={styles.championName}>{nameOf(championSteamId)}</div>
                <div>Batak Mundial Şampiyonu</div>
              </>
            ) : (
              <div>Kupa sahibini bekliyor</div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
