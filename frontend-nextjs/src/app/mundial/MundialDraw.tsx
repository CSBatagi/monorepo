'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dices, Eye, FastForward, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { useSession } from '@/contexts/SessionContext';
import { drawMundialGroups, resetMundialDraw } from '@/lib/liveApi';
import {
  NAME_AT,
  PLACE_AT,
  buildRehearsalDraw,
  drawTimeline,
  revealFrameAt,
  type MundialConfig,
  type MundialDraw as MundialDrawData,
  type RevealFrame,
} from '@/lib/mundial';
import { CLEAR_ATTENDANCE_PASSWORD, getErrorMessage } from '@/components/superliga/SuperligaPanels';
import styles from './mundial.module.css';

type SessionUser = ReturnType<typeof useSession>['user'];

const LIVE_COUNTDOWN_MS = 15000;
const REHEARSAL_COUNTDOWN_MS = 3000;
const REHEARSAL_STEP_MS = 4500;
const POT_INTRO_MS = 3000;
const CONFETTI_COLORS = ['#f7cf6a', '#e0a52f', '#34d399', '#60a5fa', '#f472b6', '#ffffff'];

function PotBadge({ potIndex }: { potIndex: number }) {
  return <span className={styles.potBadge} data-pot={potIndex + 1} title={`${potIndex + 1}. torba`}>{potIndex + 1}</span>;
}

function Confetti() {
  const pieces = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({
      left: `${(i * 37) % 100}%`,
      delay: `${(i % 14) * 0.12}s`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      duration: `${2.4 + (i % 5) * 0.35}s`,
    })),
    [],
  );
  return (
    <div className={styles.confetti} aria-hidden="true">
      {pieces.map((p, i) => (
        <span key={i} style={{ left: p.left, background: p.color, animationDelay: p.delay, animationDuration: p.duration }} />
      ))}
    </div>
  );
}

/** Kura sahnesi: geri sayım → torba torba çekiliş → gruplar. */
function DrawStage({
  draw,
  frame,
  wildcards,
  onSkip,
  showConfetti,
  label,
}: {
  draw: MundialDrawData;
  frame: RevealFrame;
  wildcards: Set<string>;
  onSkip?: () => void;
  showConfetti: boolean;
  label: string;
}) {
  const potCount = draw.pots.length;
  const placed = draw.steps.slice(0, frame.placedCount);
  const newestIndex = frame.phase === 'step' && frame.stepProgress >= PLACE_AT ? frame.stepIndex : -1;
  const hotGroup = newestIndex >= 0 ? draw.steps[newestIndex].groupId : null;
  const done = frame.phase === 'done';

  const groupSlots = draw.groups.map((group) => {
    const slots = Array.from({ length: potCount }, (_, potIndex) => {
      const stepIndex = placed.findIndex((s) => s.groupId === group.id && s.potIndex === potIndex);
      return { potIndex, step: stepIndex >= 0 ? placed[stepIndex] : null, isNew: stepIndex >= 0 && stepIndex === newestIndex };
    });
    const isDeath = placed.some((s) => s.groupId === group.id && wildcards.has(s.steamId));
    return { id: group.id, slots, isDeath };
  });

  const activePotIndex = frame.phase === 'pot-intro' || frame.phase === 'step' ? frame.potIndex : null;
  const activePot = activePotIndex !== null ? draw.pots[activePotIndex] : null;
  const drawnFromActive = new Set(
    draw.steps
      .slice(0, frame.phase === 'step' ? frame.stepIndex + (frame.stepProgress >= NAME_AT ? 1 : 0) : frame.placedCount)
      .filter((s) => s.potIndex === activePotIndex)
      .map((s) => s.steamId),
  );
  const shaking = frame.phase === 'step' && frame.stepProgress < NAME_AT;
  const currentStepIndex = frame.phase === 'step' ? frame.stepIndex : -1;
  const currentStep = currentStepIndex >= 0 ? draw.steps[currentStepIndex] : null;
  const ballNumberInPot = currentStep ? draw.steps.filter((s, i) => s.potIndex === currentStep.potIndex && i <= currentStepIndex).length : 0;

  return (
    <div className={styles.stage} aria-live="polite">
      {showConfetti && <Confetti />}
      <div className={styles.stageTop}>
        <span>{label}</span>
        {!done && onSkip && (
          <button type="button" className={styles.stageSkip} onClick={onSkip}>
            <FastForward className="mr-1 inline h-3.5 w-3.5" />Sonuca atla
          </button>
        )}
      </div>

      {frame.phase === 'countdown' ? (
        <div className={styles.countdown}>
          <div>
            <div className={styles.countdownLabel}>KURA ÇEKİMİ BAŞLIYOR</div>
            <div key={Math.ceil(frame.msToStart / 1000)} className={styles.countdownNumber}>{Math.ceil(frame.msToStart / 1000)}</div>
            <div className={styles.countdownLabel}>{draw.steps.length} OYUNCU · {potCount} TORBA · {draw.groups.length} GRUP</div>
          </div>
        </div>
      ) : (
        <>
          {done ? (
            <div className={styles.finalBanner}>
              <div className={styles.finalTitle}><Trophy className="mr-2 inline h-8 w-8" />Gruplar belli oldu!</div>
            </div>
          ) : (
            <div className={styles.stageBody}>
              <div className={styles.bowl}>
                <div className={styles.bowlTitle}>{activePot ? `${activePotIndex! + 1}. TORBA` : 'TORBA'}</div>
                <div className={styles.bowlBalls}>
                  {activePot?.players.map((p) => (
                    <span
                      key={p.steamId}
                      className={`${styles.ball} ${drawnFromActive.has(p.steamId) ? styles.ballGone : shaking ? styles.ballShaking : ''}`}
                    >
                      {activePotIndex! + 1}
                    </span>
                  ))}
                </div>
                <div className={styles.bowlProgress}>
                  {activePot?.players.map((p) => (
                    <div key={p.steamId} style={{ opacity: drawnFromActive.has(p.steamId) ? 0.35 : 1, textDecoration: drawnFromActive.has(p.steamId) ? 'line-through' : 'none' }}>
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.reveal}>
                {frame.phase === 'pot-intro' && activePot && (
                  <div key={`intro-${activePotIndex}`}>
                    <div className={styles.revealStep}>SIRADAKİ</div>
                    <div className={styles.potIntro}>{activePotIndex! + 1}. Torba</div>
                    <div className={styles.revealStep}>{activePot.players.length} OYUNCU</div>
                  </div>
                )}
                {frame.phase === 'step' && currentStep && (
                  <div key={`step-${frame.stepIndex}`}>
                    <div className={styles.revealStep}>{currentStep.potIndex + 1}. TORBA · {ballNumberInPot}. TOP</div>
                    {frame.stepProgress < NAME_AT ? (
                      <div className={styles.bigBall}>?</div>
                    ) : (
                      <div className={styles.revealName}>{currentStep.name}</div>
                    )}
                    {frame.stepProgress >= PLACE_AT ? (
                      <div className={styles.revealGroup}>GRUP {currentStep.groupId}</div>
                    ) : frame.stepProgress >= NAME_AT ? (
                      <div className={styles.revealPending}><span className={`${styles.ball} ${styles.ballShaking}`} style={{ display: 'inline-grid' }}>?</span></div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={`${styles.groupGrid} ${styles.stageGroups}`}>
            {groupSlots.map((group) => (
              <div key={group.id} className={`${styles.groupCard} ${hotGroup === group.id ? styles.groupCardHot : ''}`}>
                <div className={styles.groupHead}>
                  <span>GRUP {group.id}</span>
                  {group.isDeath && <span className={styles.deathBadge}>ÖLÜM GRUBU 💀</span>}
                </div>
                <div className={styles.groupSlots}>
                  {group.slots.map(({ potIndex, step, isNew }) => {
                    if (!step && done) return null;
                    return step ? (
                      <div key={potIndex} className={`${styles.groupSlot} ${isNew ? styles.groupSlotNew : ''}`}>
                        <PotBadge potIndex={potIndex} />
                        <span className={styles.slotName}>{step.name}</span>
                      </div>
                    ) : (
                      <div key={potIndex} className={`${styles.groupSlot} ${styles.groupSlotEmpty}`}>{potIndex + 1}. torba</div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Re-renders on an interval while the ceremony is playing. */
function useTicker(active: boolean, intervalMs = 120) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
}

export default function MundialDraw({
  config,
  draw,
  clockOffset,
  nameOf,
  user,
  onChanged,
}: {
  config: MundialConfig;
  draw: MundialDrawData | null;
  clockOffset: number;
  nameOf: (steamId: string) => string;
  user: SessionUser;
  onChanged: () => Promise<void> | void;
}) {
  const groupCount = config.groupCount || 4;
  const tentative = useMemo(() => new Set(config.tentative || []), [config.tentative]);
  const wildcards = useMemo(() => new Set(config.wildcards || []), [config.wildcards]);
  const [tentativeChoice, setTentativeChoice] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [replayStart, setReplayStart] = useState<number | null>(null);
  const [rehearsal, setRehearsal] = useState<MundialDrawData | null>(null);

  // Yeni bir kura gelince (ör. sıfırlanıp yeniden çekildiğinde) yerel durumları temizle.
  useEffect(() => {
    setSkipped(false);
    setReplayStart(null);
    if (draw) setRehearsal(null);
  }, [draw?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const undecided = [...tentative].filter((id) => tentativeChoice[id] === undefined);

  const drawPots = useMemo(() => (config.pots || []).map((pot) => ({
    id: pot.id,
    players: pot.players
      .filter((id) => !tentative.has(id) || tentativeChoice[id] === true)
      .map((steamId) => ({ steamId, name: nameOf(steamId) })),
  })), [config.pots, tentative, tentativeChoice, nameOf]);
  const participantCount = drawPots.reduce((n, pot) => n + pot.players.length, 0);
  const oversizedPot = drawPots.find((pot) => pot.players.length > groupCount);

  // Oynatılan kura: prova (yerel) ya da gerçek (sunucu). Tekrar izleme de yereldir.
  const shown = rehearsal || draw;
  const localClock = !!rehearsal || replayStart !== null;
  const startAt = rehearsal ? rehearsal.revealStartsAt : replayStart ?? draw?.revealStartsAt ?? 0;
  const totalMs = shown ? drawTimeline(shown).totalMs : 0;
  // Frames are always derived from the current (server-aligned) time, so a tab
  // that was hidden during the ceremony resumes at the right moment.
  const elapsed = Date.now() + (localClock ? 0 : clockOffset) - startAt;
  const running = !!shown && !skipped && elapsed < totalMs + 4000;
  useTicker(running);
  const frame: RevealFrame | null = shown
    ? skipped ? { phase: 'done', placedCount: shown.steps.length } : revealFrameAt(shown, elapsed)
    : null;
  const showConfetti = !!frame && frame.phase === 'done' && !skipped && elapsed - totalMs < 4000;

  // Bring the stage into view whenever a playback (live, rehearsal or replay) starts.
  const stageRef = useRef<HTMLDivElement>(null);
  const playbackKey = shown ? `${shown.createdAt}:${replayStart ?? ''}` : '';
  const isPlaying = !!frame && frame.phase !== 'done';
  useEffect(() => {
    if (playbackKey && isPlaying) stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [playbackKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDraw = async () => {
    setError(null);
    setMessage(null);
    if (!user) { setError('Kurayı çekmek için giriş yapmalısın.'); return; }
    if (undecided.length) { setError(`Önce katılımı belirle: ${undecided.map(nameOf).join(', ')}.`); return; }
    if (oversizedPot) { setError(`${oversizedPot.id}. torbada gruptan fazla oyuncu var.`); return; }
    const password = window.prompt('Kura çekmek için şifre girin:');
    if (password === null) return;
    if (password !== CLEAR_ATTENDANCE_PASSWORD) { setError('Hatalı şifre.'); return; }
    const ok = window.confirm(
      `${participantCount} oyuncu ${groupCount} gruba ayrılacak.\n\n` +
      `Kura sunucuda çekilir ve kaydedilir; sayfayı açık tutan herkes töreni ${LIVE_COUNTDOWN_MS / 1000} saniye sonra aynı anda canlı izler.\n\nBaşlatılsın mı?`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await drawMundialGroups({
        pots: drawPots,
        groupCount,
        countdownMs: LIVE_COUNTDOWN_MS,
        setByUid: user.uid,
        setByName: user.name || user.email || '',
      });
      setRehearsal(null);
      await onChanged();
    } catch (e: unknown) {
      setError(`Hata: ${getErrorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    const password = window.prompt('Kurayı sıfırlamak için şifre girin:');
    if (password === null) return;
    if (password !== CLEAR_ATTENDANCE_PASSWORD) { setError('Hatalı şifre.'); return; }
    if (!window.confirm('Kura ve girilmiş tüm eleme sonuçları silinecek. Emin misin?')) return;
    setBusy(true);
    try {
      await resetMundialDraw();
      await onChanged();
      setMessage('Kura sıfırlandı.');
    } catch (e: unknown) {
      setError(`Hata: ${getErrorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startRehearsal = () => {
    setError(null);
    setMessage(null);
    if (oversizedPot) { setError(`${oversizedPot.id}. torbada gruptan fazla oyuncu var.`); return; }
    setSkipped(false);
    setRehearsal(buildRehearsalDraw(drawPots, groupCount, {
      startsInMs: REHEARSAL_COUNTDOWN_MS,
      stepMs: REHEARSAL_STEP_MS,
      potIntroMs: POT_INTRO_MS,
    }));
  };

  const drawnAt = draw ? new Date(draw.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  return (
    <div className="flex flex-col gap-4">
      {shown && frame && (
        <div ref={stageRef} className={styles.stageAnchor}>
          <DrawStage
            draw={shown}
            frame={frame}
            wildcards={wildcards}
            showConfetti={showConfetti}
            onSkip={() => setSkipped(true)}
            label={rehearsal ? 'PROVA KURA · KAYDEDİLMEZ, SADECE SENDE' : replayStart !== null ? 'TEKRAR · KURA TÖRENİ' : frame.phase === 'done' ? 'BATAK MUNDIAL · KURA SONUCU' : '● CANLI · BATAK MUNDIAL KURA TÖRENİ'}
          />
          <div className={styles.drawMeta}>
            <span>
              {rehearsal
                ? 'Bu bir prova: sonuç kaydedilmedi, kimse görmedi.'
                : draw && `Kura ${drawnAt} tarihinde${draw.setByName ? ` ${draw.setByName} tarafından` : ''} sunucuda çekildi.`}
            </span>
            <span className="flex flex-wrap items-center gap-3">
              {rehearsal ? (
                <button type="button" className={styles.ghostButton} onClick={() => setRehearsal(null)}>Provayı kapat</button>
              ) : draw && frame.phase === 'done' ? (
                <>
                  <button type="button" className={styles.ghostButton} onClick={() => { setSkipped(false); setReplayStart(Date.now() + REHEARSAL_COUNTDOWN_MS); }}>
                    <RotateCcw className="h-4 w-4" />Töreni tekrar izle
                  </button>
                  {user && <button type="button" className={styles.dangerLink} onClick={handleReset} disabled={busy}>Kurayı sıfırla</button>}
                </>
              ) : null}
            </span>
          </div>
        </div>
      )}

      {!draw && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}><Dices className="h-5 w-5" />Kura Çekimi</div>
          <p className={styles.muted}>
            Torbalar Superliga sezon sonu sıralamasına göre oluşturuldu (1-4 → 1. torba, 5-8 → 2. torba …).
            Kurada her torbadan önce bir oyuncu, sonra o torbadan henüz oyuncu almamış gruplardan biri çekilir;
            böylece her grupta her torbadan en fazla bir kişi olur. Kura sunucuda tek seferde çekilir ve
            sayfayı açık tutan herkes töreni aynı anda canlı izler.
          </p>

          <div className={`${styles.potGrid} mt-4`}>
            {(config.pots || []).map((pot, potIndex) => (
              <div key={pot.id} className={styles.potCard}>
                <div className={styles.potHeader}>
                  <span>{pot.id}. TORBA</span>
                  <PotBadge potIndex={potIndex} />
                </div>
                {pot.players.map((steamId) => {
                  const isTentative = tentative.has(steamId);
                  const choice = tentativeChoice[steamId];
                  return (
                    <div key={steamId}>
                      <div className={styles.potPlayer}>
                        <span className={`${styles.potPlayerName} ${isTentative && choice === false ? styles.potPlayerOut : ''}`}>{nameOf(steamId)}</span>
                        {isTentative && <span title="Katılımı kesin değil">{choice === true ? '✓' : choice === false ? '✕' : '?'}</span>}
                      </div>
                      {isTentative && (
                        <div className={styles.tentativeBox}>
                          <div>{nameOf(steamId)} katılıyor mu?</div>
                          <div className={styles.toggleRow}>
                            <button type="button" className={`${styles.toggle} ${choice === true ? styles.toggleOn : ''}`} onClick={() => setTentativeChoice((c) => ({ ...c, [steamId]: true }))}>Evet</button>
                            <button type="button" className={`${styles.toggle} ${choice === false ? styles.toggleOn : ''}`} onClick={() => setTentativeChoice((c) => ({ ...c, [steamId]: false }))}>Hayır</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <p className={`${styles.muted} mt-3`}>
            {participantCount} oyuncu · {groupCount} grup ·{' '}
            {participantCount % groupCount === 0
              ? `her grupta ${participantCount / groupCount} kişi.`
              : `bir ya da daha fazla grup ${Math.floor(participantCount / groupCount)} kişi kalır — kura şansı.`}
            {wildcards.size > 0 && ' Joker oyuncunun düştüğü grup ölüm grubu olur 💀'}
          </p>

          <div className={styles.drawActions}>
            <button type="button" className={styles.primaryButton} onClick={handleDraw} disabled={busy || !user}>
              <Sparkles className="h-5 w-5" />{busy ? 'Kura çekiliyor…' : 'Kurayı Başlat'}
            </button>
            <button type="button" className={styles.ghostButton} onClick={startRehearsal} disabled={busy}>
              <Eye className="h-4 w-4" />Prova kura (kaydedilmez)
            </button>
            {!user && <span className={styles.muted}>Kurayı başlatmak için giriş yapmalısın.</span>}
          </div>
        </div>
      )}

      {message && <p className={styles.message}>{message}</p>}
      {error && <p className={styles.errorMessage}>{error}</p>}
    </div>
  );
}
