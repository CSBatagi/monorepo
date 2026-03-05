'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { db } from '@/lib/firebase';
import { off, onValue, ref, remove, set } from 'firebase/database';
import { Trophy, Crown, Swords, Shield, Star, Trash2 } from 'lucide-react';

import {
  deriveSuperKupaParticipants,
  type AllStarsConfig,
  type PlayerStanding,
  type PlayersIndex,
  type SuperKupaData,
  type SuperKupaMatchResult,
  type SuperKupaPlayer,
} from '@/lib/batakAllStars';

const CLEAR_ATTENDANCE_PASSWORD = process.env.NEXT_PUBLIC_CLEAR_ATTENDANCE_PASSWORD || 'osirikler';

const SUPER_KUPA_DB_PATH = 'batakAllStars/superKupa';

type MatchSlot = 'semi1' | 'semi2' | 'final';

// ── Visual helpers ─────────────────────────────────────────────

function PlayerCard({
  player,
  isWinner,
  isFinalWinner,
  highlight,
}: {
  player: SuperKupaPlayer | null;
  isWinner?: boolean;
  isFinalWinner?: boolean;
  highlight?: 'green' | 'blue' | null;
}) {
  if (!player) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 min-w-[140px]">
        <span className="text-sm text-gray-400 italic">Bekliyor…</span>
      </div>
    );
  }

  const borderClass = isFinalWinner
    ? 'border-yellow-400 sk-winner-bg shadow-lg'
    : isWinner
      ? highlight === 'green'
        ? 'border-green-500 bg-green-50'
        : 'border-blue-500 bg-blue-50'
      : 'border-gray-300 bg-white';

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 min-w-[140px] transition-all duration-300 ${borderClass}`}>
      {isFinalWinner && <Trophy className="w-5 h-5 text-yellow-500 flex-shrink-0" />}
      {isWinner && !isFinalWinner && <Crown className="w-4 h-4 text-green-600 flex-shrink-0" />}
      <div className="flex flex-col min-w-0">
        <span className={`text-sm font-semibold truncate ${isFinalWinner ? 'text-yellow-700' : isWinner ? 'text-green-700' : 'text-gray-800'}`}>
          {player.name}
        </span>
        <span className="text-[10px] text-gray-500 truncate">{player.leagueName}</span>
      </div>
    </div>
  );
}

function MatchResultBadge({ score, winnerId, player1Id }: { score?: string; winnerId?: string; player1Id?: string }) {
  if (!score || !winnerId) return null;
  return (
    <div className="flex items-center justify-center">
      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">
        {score}
      </span>
    </div>
  );
}

// ── Admin match entry ────────────────────────────────────────

function AdminMatchControls({
  matchSlot,
  player1,
  player2,
  currentResult,
  onSave,
  onDelete,
}: {
  matchSlot: MatchSlot;
  player1: SuperKupaPlayer | null;
  player2: SuperKupaPlayer | null;
  currentResult: SuperKupaMatchResult | null | undefined;
  onSave: (slot: MatchSlot, winnerSteamId: string, score: string) => Promise<void>;
  onDelete: (slot: MatchSlot) => Promise<void>;
}) {
  const [winnerSteamId, setWinnerSteamId] = useState('');
  const [score, setScore] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from existing result
  useEffect(() => {
    if (currentResult?.winnerSteamId) {
      setWinnerSteamId(currentResult.winnerSteamId);
      setScore(currentResult.score || '');
    } else {
      setWinnerSteamId('');
      setScore('');
    }
  }, [currentResult]);

  if (!player1 || !player2) {
    return (
      <div className="text-xs text-gray-400 italic mt-1">Oyuncular belli değil</div>
    );
  }

  const labels: Record<string, string> = { semi1: 'Yarı Final 1', semi2: 'Yarı Final 2', final: 'Final' };

  const handleSave = async () => {
    if (!winnerSteamId) {
      setError('Kazananı seçin.');
      return;
    }
    if (!score.trim()) {
      setError('Skoru girin (ör: 2-0).');
      return;
    }
    const pw = window.prompt(`${labels[matchSlot]} sonucunu kaydetmek için şifre girin:`);
    if (pw === null) return;
    if (pw !== CLEAR_ATTENDANCE_PASSWORD) {
      setError('Hatalı şifre.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(matchSlot, winnerSteamId, score.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentResult?.winnerSteamId) return;
    const ok = window.confirm(`${labels[matchSlot]} sonucunu silmek istediğinize emin misiniz?`);
    if (!ok) return;
    const pw = window.prompt('Silmek için şifre girin:');
    if (pw === null) return;
    if (pw !== CLEAR_ATTENDANCE_PASSWORD) {
      setError('Hatalı şifre.');
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await onDelete(matchSlot);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Hata oluştu');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-2 p-2 rounded border border-gray-200 bg-gray-50 space-y-2">
      <div className="text-xs font-medium text-gray-600">{labels[matchSlot]} — Sonuç Gir</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="border rounded px-2 py-1 text-xs flex-1 min-w-[120px]"
          value={winnerSteamId}
          onChange={(e) => setWinnerSteamId(e.target.value)}
        >
          <option value="">Kazanan seç</option>
          <option value={player1.steamId}>{player1.name} ({player1.leagueName})</option>
          <option value={player2.steamId}>{player2.name} ({player2.leagueName})</option>
        </select>
        <input
          type="text"
          placeholder="Skor (ör: 2-0)"
          className="border rounded px-2 py-1 text-xs w-24"
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1 rounded text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 transition-colors"
        >
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {currentResult?.winnerSteamId && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-2 py-1 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-60 transition-colors flex items-center gap-1"
            title="Sonucu sil"
          >
            <Trash2 className="w-3 h-3" />
            {deleting ? 'Siliniyor…' : 'Sil'}
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}

// ── Main bracket component ─────────────────────────────────────

export default function SuperKupaBracket({
  standingsByLeague,
  config,
  playersIndex,
}: {
  standingsByLeague: Record<string, { id: string; name: string; standings: PlayerStanding[] }> | null;
  config: AllStarsConfig;
  playersIndex: PlayersIndex;
}) {
  const { user } = useAuth();
  const { isDark } = useTheme();

  // Firebase real-time data
  const [superKupaData, setSuperKupaData] = useState<SuperKupaData | null>(null);

  useEffect(() => {
    const dbRef = ref(db, SUPER_KUPA_DB_PATH);
    const unsub = onValue(
      dbRef,
      (snap) => setSuperKupaData((snap.val() || null) as SuperKupaData | null),
      () => { /* ignore */ },
    );
    return () => off(dbRef, 'value', unsub);
  }, []);

  // Derive participants from standings
  const participants = useMemo(() => {
    return deriveSuperKupaParticipants(standingsByLeague, config.leagues || []);
  }, [standingsByLeague, config.leagues]);

  // Resolve effective players for each bracket slot (from standings, may be overridden by saved data)
  const semi1Player1 = participants.semi1[0];
  const semi1Player2 = participants.semi1[1];
  const semi2Player1 = participants.semi2[0];
  const semi2Player2 = participants.semi2[1];

  const semi1Result = superKupaData?.semi1 ?? null;
  const semi2Result = superKupaData?.semi2 ?? null;
  const finalResult = superKupaData?.final ?? null;

  // Determine finalists from semi-final winners
  const semi1Winner: SuperKupaPlayer | null = useMemo(() => {
    if (!semi1Result?.winnerSteamId) return null;
    if (semi1Result.winnerSteamId === semi1Player1?.steamId) return semi1Player1;
    if (semi1Result.winnerSteamId === semi1Player2?.steamId) return semi1Player2;
    return null;
  }, [semi1Result, semi1Player1, semi1Player2]);

  const semi2Winner: SuperKupaPlayer | null = useMemo(() => {
    if (!semi2Result?.winnerSteamId) return null;
    if (semi2Result.winnerSteamId === semi2Player1?.steamId) return semi2Player1;
    if (semi2Result.winnerSteamId === semi2Player2?.steamId) return semi2Player2;
    return null;
  }, [semi2Result, semi2Player1, semi2Player2]);

  const finalWinner: SuperKupaPlayer | null = useMemo(() => {
    if (!finalResult?.winnerSteamId) return null;
    if (finalResult.winnerSteamId === semi1Winner?.steamId) return semi1Winner;
    if (finalResult.winnerSteamId === semi2Winner?.steamId) return semi2Winner;
    return null;
  }, [finalResult, semi1Winner, semi2Winner]);

  // Save handler
  const handleSaveResult = useCallback(
    async (slot: MatchSlot, winnerSteamId: string, score: string) => {
      if (!user) throw new Error('Giriş gerekli.');

      let p1: SuperKupaPlayer | null = null;
      let p2: SuperKupaPlayer | null = null;

      if (slot === 'semi1') {
        p1 = semi1Player1;
        p2 = semi1Player2;
      } else if (slot === 'semi2') {
        p1 = semi2Player1;
        p2 = semi2Player2;
      } else if (slot === 'final') {
        p1 = semi1Winner;
        p2 = semi2Winner;
      }

      if (!p1 || !p2) throw new Error('Her iki oyuncu da belli olmalı.');

      const record: SuperKupaMatchResult = {
        player1SteamId: p1.steamId,
        player1Name: p1.name,
        player1League: p1.leagueName,
        player2SteamId: p2.steamId,
        player2Name: p2.name,
        player2League: p2.leagueName,
        winnerSteamId,
        score,
        date: new Date().toISOString().split('T')[0],
        setByUid: user.uid,
        setByName: user.displayName || user.email || undefined,
        setAt: Date.now(),
      };

      await set(ref(db, `${SUPER_KUPA_DB_PATH}/${slot}`), record);
    },
    [user, semi1Player1, semi1Player2, semi2Player1, semi2Player2, semi1Winner, semi2Winner],
  );

  // Delete a single match result
  const handleDeleteResult = useCallback(
    async (slot: MatchSlot) => {
      if (!user) throw new Error('Giriş gerekli.');
      await remove(ref(db, `${SUPER_KUPA_DB_PATH}/${slot}`));
      // If deleting a semi-final, also clear the final since it depends on the winner
      if (slot === 'semi1' || slot === 'semi2') {
        await remove(ref(db, `${SUPER_KUPA_DB_PATH}/final`));
      }
    },
    [user],
  );

  // Reset all results
  const [resettingAll, setResettingAll] = useState(false);
  const handleResetAll = useCallback(async () => {
    if (!user) return;
    const ok = window.confirm('Tüm Süper Kupa sonuçlarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.');
    if (!ok) return;
    const pw = window.prompt('Tümünü sıfırlamak için şifre girin:');
    if (pw === null) return;
    if (pw !== CLEAR_ATTENDANCE_PASSWORD) {
      window.alert('Hatalı şifre.');
      return;
    }
    setResettingAll(true);
    try {
      await remove(ref(db, SUPER_KUPA_DB_PATH));
    } finally {
      setResettingAll(false);
    }
  }, [user]);

  const allEmpty = !semi1Player1 && !semi1Player2 && !semi2Player1 && !semi2Player2;

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="border rounded p-4">
      {/* Header with Super Kupa logo */}
      <div className="relative flex flex-col items-center mb-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.07] pointer-events-none">
            <Trophy className="w-32 h-32 text-yellow-500" />
          </div>
          <div className="flex items-center gap-3 relative z-10">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <div className="text-center">
              <h3 className="text-xl font-bold text-gray-800">Süper Kupa</h3>
              <p className="text-xs text-gray-500">Lig liderlerinin playoff turnuvası</p>
            </div>
            <Trophy className="w-8 h-8 text-yellow-500" />
          </div>
        </div>
      </div>

      {allEmpty ? (
        <div className="text-sm text-gray-600 text-center py-8">
          Henüz yeterli sıralama verisi yok. Lig maçları tamamlandığında katılımcılar burada görünecek.
        </div>
      ) : (
        <>
          {/* ── Champion Banner ────────────────────────────── */}
          {finalWinner && (
            <div className="mb-6 relative overflow-hidden rounded-xl border-2 border-yellow-300 sk-champion-bg p-6">
              {/* Background decoration */}
              <div className="absolute inset-0 flex items-center justify-center opacity-[0.06] pointer-events-none">
                <Trophy className="w-64 h-64 text-yellow-600" />
              </div>
              <div className="absolute top-2 left-4 opacity-20 pointer-events-none">
                <Star className="w-8 h-8 text-yellow-500 fill-yellow-400" />
              </div>
              <div className="absolute top-4 right-6 opacity-20 pointer-events-none">
                <Star className="w-6 h-6 text-yellow-500 fill-yellow-400" />
              </div>
              <div className="absolute bottom-3 left-8 opacity-15 pointer-events-none">
                <Star className="w-5 h-5 text-yellow-500 fill-yellow-400" />
              </div>
              <div className="absolute bottom-2 right-4 opacity-15 pointer-events-none">
                <Star className="w-7 h-7 text-yellow-500 fill-yellow-400" />
              </div>

              <div className="relative z-10 flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  <Crown className="w-6 h-6 text-yellow-600" />
                  <span className="text-sm font-bold uppercase tracking-widest text-yellow-700">Süper Kupa Şampiyonu</span>
                  <Crown className="w-6 h-6 text-yellow-600" />
                </div>
                <div className="flex items-center gap-3">
                  <Trophy className="w-10 h-10 text-yellow-500" />
                  <div className="text-center">
                    <div className="text-2xl font-extrabold text-yellow-800">{finalWinner.name}</div>
                    <div className="text-xs text-yellow-600 font-medium">{finalWinner.leagueName} Lideri</div>
                  </div>
                  <Trophy className="w-10 h-10 text-yellow-500" />
                </div>
                {finalResult?.score && (
                  <div className="text-xs text-yellow-700 font-mono font-semibold mt-1">
                    Final: {finalResult.score}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Bracket Visualization ────────────────────── */}
          {/* Desktop layout — horizontal bracket */}
          <div className="hidden md:block">
            <div className="flex items-center justify-center gap-0 min-h-[320px]">
              {/* Semi-finals column */}
              <div className="flex flex-col justify-center gap-16 w-[220px]">
                {/* Semi 1 */}
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 px-1">Yarı Final 1</div>
                  <PlayerCard player={semi1Player1} isWinner={semi1Winner?.steamId === semi1Player1?.steamId} />
                  <div className="flex items-center gap-1 px-2">
                    <Swords className="w-3 h-3 text-gray-400" />
                    {semi1Result?.score && <MatchResultBadge score={semi1Result.score} winnerId={semi1Result.winnerSteamId} player1Id={semi1Player1?.steamId} />}
                    {!semi1Result?.score && <span className="text-[10px] text-gray-400">vs</span>}
                  </div>
                  <PlayerCard player={semi1Player2} isWinner={semi1Winner?.steamId === semi1Player2?.steamId} />
                </div>

                {/* Semi 2 */}
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 px-1">Yarı Final 2</div>
                  <PlayerCard player={semi2Player1} isWinner={semi2Winner?.steamId === semi2Player1?.steamId} />
                  <div className="flex items-center gap-1 px-2">
                    <Swords className="w-3 h-3 text-gray-400" />
                    {semi2Result?.score && <MatchResultBadge score={semi2Result.score} winnerId={semi2Result.winnerSteamId} player1Id={semi2Player1?.steamId} />}
                    {!semi2Result?.score && <span className="text-[10px] text-gray-400">vs</span>}
                  </div>
                  <PlayerCard player={semi2Player2} isWinner={semi2Winner?.steamId === semi2Player2?.steamId} />
                </div>
              </div>

              {/* Connector lines */}
              <div className="flex flex-col items-center justify-center w-[60px] relative">
                <svg className="w-[60px] h-[320px]" viewBox="0 0 60 320" fill="none">
                  {/* Semi 1 → Final */}
                  <path d="M 0 80 H 30 V 160 H 60" stroke={isDark ? '#374151' : '#CBD5E1'} strokeWidth="2" fill="none" />
                  {/* Semi 2 → Final */}
                  <path d="M 0 240 H 30 V 160 H 60" stroke={isDark ? '#374151' : '#CBD5E1'} strokeWidth="2" fill="none" />
                </svg>
              </div>

              {/* Final column */}
              <div className="flex flex-col justify-center w-[220px]">
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-yellow-600 mb-1 px-1 flex items-center gap-1">
                    <Trophy className="w-3 h-3" /> Final
                  </div>
                  <PlayerCard
                    player={semi1Winner}
                    isWinner={finalWinner?.steamId === semi1Winner?.steamId}
                    isFinalWinner={finalWinner?.steamId === semi1Winner?.steamId}
                  />
                  <div className="flex items-center gap-1 px-2">
                    <Swords className="w-3 h-3 text-yellow-500" />
                    {finalResult?.score && <MatchResultBadge score={finalResult.score} winnerId={finalResult.winnerSteamId} player1Id={semi1Winner?.steamId} />}
                    {!finalResult?.score && semi1Winner && semi2Winner && <span className="text-[10px] text-gray-400">vs</span>}
                  </div>
                  <PlayerCard
                    player={semi2Winner}
                    isWinner={finalWinner?.steamId === semi2Winner?.steamId}
                    isFinalWinner={finalWinner?.steamId === semi2Winner?.steamId}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Mobile layout — stacked bracket */}
          <div className="md:hidden space-y-4">
            {/* Semi 1 */}
            <div className="border rounded-lg p-3 bg-white">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Yarı Final 1</div>
              <div className="flex flex-col gap-1">
                <PlayerCard player={semi1Player1} isWinner={semi1Winner?.steamId === semi1Player1?.steamId} />
                <div className="flex items-center gap-1 px-2 py-0.5">
                  <Swords className="w-3 h-3 text-gray-400" />
                  {semi1Result?.score ? (
                    <MatchResultBadge score={semi1Result.score} winnerId={semi1Result.winnerSteamId} player1Id={semi1Player1?.steamId} />
                  ) : (
                    <span className="text-[10px] text-gray-400">vs</span>
                  )}
                </div>
                <PlayerCard player={semi1Player2} isWinner={semi1Winner?.steamId === semi1Player2?.steamId} />
              </div>
            </div>

            {/* Semi 2 */}
            <div className="border rounded-lg p-3 bg-white">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Yarı Final 2</div>
              <div className="flex flex-col gap-1">
                <PlayerCard player={semi2Player1} isWinner={semi2Winner?.steamId === semi2Player1?.steamId} />
                <div className="flex items-center gap-1 px-2 py-0.5">
                  <Swords className="w-3 h-3 text-gray-400" />
                  {semi2Result?.score ? (
                    <MatchResultBadge score={semi2Result.score} winnerId={semi2Result.winnerSteamId} player1Id={semi2Player1?.steamId} />
                  ) : (
                    <span className="text-[10px] text-gray-400">vs</span>
                  )}
                </div>
                <PlayerCard player={semi2Player2} isWinner={semi2Winner?.steamId === semi2Player2?.steamId} />
              </div>
            </div>

            {/* Connector arrow */}
            <div className="flex justify-center">
              <div className="w-px h-4 bg-gray-300" />
            </div>

            {/* Final */}
            <div className="border-2 border-yellow-300 rounded-lg p-3 sk-final-mobile-bg">
              <div className="text-[10px] font-bold uppercase tracking-wider text-yellow-600 mb-2 flex items-center gap-1">
                <Trophy className="w-3 h-3" /> Final
              </div>
              <div className="flex flex-col gap-1">
                <PlayerCard
                  player={semi1Winner}
                  isWinner={finalWinner?.steamId === semi1Winner?.steamId}
                  isFinalWinner={finalWinner?.steamId === semi1Winner?.steamId}
                />
                <div className="flex items-center gap-1 px-2 py-0.5">
                  <Swords className="w-3 h-3 text-yellow-500" />
                  {finalResult?.score ? (
                    <MatchResultBadge score={finalResult.score} winnerId={finalResult.winnerSteamId} player1Id={semi1Winner?.steamId} />
                  ) : semi1Winner && semi2Winner ? (
                    <span className="text-[10px] text-gray-400">vs</span>
                  ) : null}
                </div>
                <PlayerCard
                  player={semi2Winner}
                  isWinner={finalWinner?.steamId === semi2Winner?.steamId}
                  isFinalWinner={finalWinner?.steamId === semi2Winner?.steamId}
                />
              </div>
            </div>
          </div>

          {/* ── Admin Controls (logged in users) ────────── */}
          {user && (
            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-semibold text-gray-700">Yönetim — Maç Sonuçları</span>
                </div>
                {superKupaData && (superKupaData.semi1 || superKupaData.semi2 || superKupaData.final) && (
                  <button
                    onClick={handleResetAll}
                    disabled={resettingAll}
                    className="px-3 py-1 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white disabled:opacity-60 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    {resettingAll ? 'Sıfırlanıyor…' : 'Tümünü Sıfırla'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <AdminMatchControls
                  matchSlot="semi1"
                  player1={semi1Player1}
                  player2={semi1Player2}
                  currentResult={semi1Result}
                  onSave={handleSaveResult}
                  onDelete={handleDeleteResult}
                />
                <AdminMatchControls
                  matchSlot="semi2"
                  player1={semi2Player1}
                  player2={semi2Player2}
                  currentResult={semi2Result}
                  onSave={handleSaveResult}
                  onDelete={handleDeleteResult}
                />
              </div>
              {semi1Winner && semi2Winner && (
                <div className="mt-3">
                  <AdminMatchControls
                    matchSlot="final"
                    player1={semi1Winner}
                    player2={semi2Winner}
                    currentResult={finalResult}
                    onSave={handleSaveResult}
                    onDelete={handleDeleteResult}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Info note ────────────────────────────────── */}
          <div className="mt-4 text-xs text-gray-500 space-y-1">
            <div className="font-medium">Not:</div>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Yarı Final 1: 1. Lig lideri vs 4. Lig lideri</li>
              <li>Yarı Final 2: 2. Lig lideri vs 3. Lig lideri</li>
              <li>Katılımcılar güncel lig sıralamasına göre belirlenir.</li>
              <li>Sonuçlar Firebase içinde tutulur: <span className="font-mono">batakAllStars/superKupa/</span></li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
