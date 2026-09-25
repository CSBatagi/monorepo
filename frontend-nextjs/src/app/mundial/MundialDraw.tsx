'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dices, Eye, Hand, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import type { useSession } from '@/contexts/SessionContext';
import { advanceMundialDraw, resetMundialDraw, startMundialDraw } from '@/lib/liveApi';
import {
  advanceRehearsalDraw,
  drawRevealCount,
  drawTotalReveals,
  emptyDraw,
  nextBall,
  stepsAtCursor,
  type MundialConfig,
  type MundialDraw as MundialDrawData,
} from '@/lib/mundial';
import { getErrorMessage } from '@/components/superliga/SuperligaPanels';
import styles from './mundial.module.css';

type SessionUser = ReturnType<typeof useSession>['user'];

/** How long a ball shakes before it opens, on every screen. */
const SHAKE_MS = 1400;
/** Replay pace for a finished draw. */
const REPLAY_BALL_MS = 2300;
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

/**
 * Follows the number of opened balls (`target`) with a short shake before each
 * new ball opens. A new `sourceKey` (another draw, rehearsal or replay) jumps
 * straight to its current state without animating the history.
 */
function useRevealAnimation(sourceKey: string, target: number) {
  const [shown, setShown] = useState(target);
  const [shaking, setShaking] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const keyRef = useRef(sourceKey);
  const shownRef = useRef(target);

  useEffect(() => {
    const show = (value: number) => { shownRef.current = value; setShown(value); };
    if (keyRef.current !== sourceKey) {
      keyRef.current = sourceKey;
      show(target);
      setShaking(false);
      setJustOpened(false);
      return;
    }
    if (target <= shownRef.current) {
      if (target < shownRef.current) { show(target); setShaking(false); setJustOpened(false); }
      return;
    }
    // Several balls arrived at once (slow poll): jump to the one before the latest.
    if (target - 1 > shownRef.current) show(target - 1);
    setShaking(true);
    setJustOpened(false);
    const timer = window.setTimeout(() => { show(target); setShaking(false); setJustOpened(true); }, SHAKE_MS);
    return () => window.clearTimeout(timer);
  }, [sourceKey, target]);

  return { shown, shaking, justOpened };
}

function DrawStage({
  draw,
  cursor,
  shaking,
  justOpened,
  wildcards,
  label,
  controls,
}: {
  draw: MundialDrawData;
  cursor: number;
  shaking: boolean;
  justOpened: boolean;
  wildcards: Set<string>;
  label: string;
  controls?: ReactNode;
}) {
  const total = drawTotalReveals(draw);
  const visible = stepsAtCursor(draw, cursor);
  const complete = cursor >= total && !shaking;
  const last = visible[visible.length - 1] || null;
  const upcoming = nextBall(draw, visible);
  // While shaking, the ball being opened is the next one after the visible state.
  const openingKind = shaking ? upcoming?.kind ?? null : null;
  const lastJustGrouped = justOpened && !!last?.groupId && cursor % 2 === 0;
  const lastJustNamed = justOpened && !!last && !last.groupId;

  const activePotIndex = upcoming ? (upcoming.kind === 'player' ? upcoming.potIndex : upcoming.step.potIndex) : null;
  const activePot = activePotIndex !== null ? draw.pots[activePotIndex] : null;
  const drawnIds = new Set(visible.map((s) => s.steamId));
  const ballNumber = (potIndex: number) => visible.filter((s) => s.potIndex === potIndex).length + (openingKind === 'player' ? 1 : 0);

  const groupSlots = draw.groups.map((group) => {
    const slots = draw.pots.map((_, potIndex) => {
      const step = visible.find((s) => s.groupId === group.id && s.potIndex === potIndex) || null;
      return { potIndex, step, isNew: !!step && lastJustGrouped && step.steamId === last?.steamId };
    });
    const isDeath = visible.some((s) => s.groupId === group.id && wildcards.has(s.steamId));
    return { id: group.id, slots, isDeath };
  });
  const hotGroup = lastJustGrouped ? last?.groupId : null;

  return (
    <div className={styles.stage} aria-live="polite">
      {complete && justOpened && <Confetti />}
      <div className={styles.stageTop}>
        <span>{label}</span>
        <span className={styles.stageCounter}>TOP {Math.min(cursor + (shaking ? 1 : 0), total)} / {total}</span>
      </div>

      {complete ? (
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
                  className={`${styles.ball} ${drawnIds.has(p.steamId) ? styles.ballGone : openingKind === 'player' ? styles.ballShaking : ''}`}
                >
                  {activePotIndex! + 1}
                </span>
              ))}
            </div>
            <div className={styles.bowlProgress}>
              {activePot?.players.map((p) => (
                <div key={p.steamId} style={{ opacity: drawnIds.has(p.steamId) ? 0.35 : 1, textDecoration: drawnIds.has(p.steamId) ? 'line-through' : 'none' }}>
                  {p.name}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.reveal}>
            {openingKind === 'player' && activePotIndex !== null ? (
              <div key={`opening-${cursor}`}>
                <div className={styles.revealStep}>{activePotIndex + 1}. TORBA · {ballNumber(activePotIndex)}. TOP</div>
                <div className={styles.bigBall}>?</div>
                <div className={styles.revealStep}>TOP AÇILIYOR…</div>
              </div>
            ) : last ? (
              <div key={`step-${visible.length}`}>
                <div className={styles.revealStep}>{last.potIndex + 1}. TORBA · {visible.filter((s) => s.potIndex === last.potIndex).length}. TOP</div>
                <div className={lastJustNamed ? styles.revealName : styles.revealNameStatic}>{last.name}</div>
                {last.groupId ? (
                  <>
                    <div className={lastJustGrouped ? styles.revealGroup : styles.revealGroupStatic}>GRUP {last.groupId}</div>
                    {upcoming?.kind === 'player' && (
                      <div className={`${styles.revealStep} mt-3`}>SIRADAKİ: {upcoming.potIndex + 1}. TORBA</div>
                    )}
                  </>
                ) : (
                  <div className={styles.revealPending}>
                    <span className={`${styles.ball} ${openingKind === 'group' ? styles.ballShaking : ''}`} style={{ display: 'inline-grid' }}>?</span>
                    <div className={styles.revealStep}>{openingKind === 'group' ? 'GRUP TOPU AÇILIYOR…' : 'SIRADA GRUP TOPU'}</div>
                  </div>
                )}
              </div>
            ) : (
              <div key={`next-${cursor}`}>
                <div className={styles.revealStep}>{cursor === 0 ? 'KURA BAŞLAMAK ÜZERE' : 'SIRADAKİ'}</div>
                {activePotIndex !== null && <div className={styles.potIntro}>{activePotIndex + 1}. Torba</div>}
                {activePot && <div className={styles.revealStep}>{activePot.players.filter((p) => !drawnIds.has(p.steamId)).length} TOP</div>}
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
                if (!step && complete) return null;
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

      {controls && <div className={styles.stageControls}>{controls}</div>}
    </div>
  );
}

function NextBallButton({
  draw,
  cursor,
  disabled,
  onClick,
}: {
  draw: MundialDrawData;
  cursor: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const ball = nextBall(draw, stepsAtCursor(draw, cursor));
  if (!ball) return null;
  const text = ball.kind === 'player'
    ? `${ball.potIndex + 1}. torbadan top çek`
    : `${ball.step.name} için grup topu çek`;
  return (
    <button type="button" className={styles.primaryButton} onClick={onClick} disabled={disabled}>
      <Hand className="h-5 w-5" />{text}
    </button>
  );
}

export default function MundialDraw({
  config,
  draw,
  nameOf,
  user,
  canOperate,
  onChanged,
}: {
  config: MundialConfig;
  draw: MundialDrawData | null;
  nameOf: (steamId: string) => string;
  user: SessionUser;
  canOperate: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const groupCount = config.groupCount || 4;
  const tentative = useMemo(() => new Set(config.tentative || []), [config.tentative]);
  const wildcards = useMemo(() => new Set(config.wildcards || []), [config.wildcards]);
  const [tentativeChoice, setTentativeChoice] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rehearsal, setRehearsal] = useState<MundialDrawData | null>(null);
  const [replayCursor, setReplayCursor] = useState<number | null>(null);

  const undecided = [...tentative].filter((id) => tentativeChoice[id] === undefined);
  const drawPots = useMemo(() => (config.pots || []).map((pot) => ({
    id: pot.id,
    players: pot.players
      .filter((id) => !tentative.has(id) || tentativeChoice[id] === true)
      .map((steamId) => ({ steamId, name: nameOf(steamId) })),
  })), [config.pots, tentative, tentativeChoice, nameOf]);
  const participantCount = drawPots.reduce((n, pot) => n + pot.players.length, 0);
  const oversizedPot = drawPots.find((pot) => pot.players.length > groupCount);

  // A live draw replaces any local rehearsal.
  useEffect(() => {
    if (draw) setRehearsal(null);
    setReplayCursor(null);
  }, [draw?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = rehearsal || draw;
  const sourceKey = rehearsal ? `rehearsal:${rehearsal.createdAt}` : replayCursor !== null ? `replay:${draw?.createdAt}` : `live:${draw?.createdAt ?? 'none'}`;
  const targetCursor = rehearsal ? drawRevealCount(rehearsal) : replayCursor ?? (draw ? drawRevealCount(draw) : 0);
  const { shown, shaking, justOpened } = useRevealAnimation(sourceKey, targetCursor);
  const total = source ? drawTotalReveals(source) : 0;
  const complete = !!source && shown >= total && !shaking;

  // Replay a finished draw locally, one ball at a time.
  useEffect(() => {
    if (replayCursor === null || !draw) return;
    const end = drawRevealCount(draw);
    const timer = window.setTimeout(
      () => (replayCursor >= end ? setReplayCursor(null) : setReplayCursor(replayCursor + 1)),
      replayCursor >= end ? SHAKE_MS + 4000 : replayCursor === 0 ? 800 : REPLAY_BALL_MS + SHAKE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [replayCursor, draw]);

  // Bring the stage into view when a ceremony, rehearsal or replay begins.
  const stageRef = useRef<HTMLDivElement>(null);
  const playing = !!source && !complete;
  useEffect(() => {
    if (playing) stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveCanAdvance = !rehearsal && replayCursor === null && !!draw && canOperate && !complete;
  const advanceDisabled = busy || shaking;

  const handleNext = async () => {
    if (advanceDisabled) return;
    setError(null);
    setMessage(null);
    if (rehearsal) {
      setRehearsal(advanceRehearsalDraw(rehearsal));
      return;
    }
    if (!draw || !liveCanAdvance) return;
    setBusy(true);
    try {
      await advanceMundialDraw(drawRevealCount(draw));
      await onChanged();
    } catch (e: unknown) {
      setMessage(getErrorMessage(e));
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  // Space / Enter / → opens the next ball for whoever is driving the draw.
  const nextRef = useRef(handleNext);
  nextRef.current = handleNext;
  const keyboardActive = !!rehearsal || liveCanAdvance;
  useEffect(() => {
    if (!keyboardActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (![' ', 'Enter', 'ArrowRight'].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      event.preventDefault();
      void nextRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardActive]);

  const handleStart = async () => {
    setError(null);
    setMessage(null);
    if (!canOperate) { setError('Kurayı yalnızca yöneticiler başlatabilir.'); return; }
    if (undecided.length) { setError(`Önce katılımı belirle: ${undecided.map(nameOf).join(', ')}.`); return; }
    if (oversizedPot) { setError(`${oversizedPot.id}. torbada gruptan fazla oyuncu var.`); return; }
    const ok = window.confirm(
      `${participantCount} oyuncu ${groupCount} gruba ayrılacak.\n\n` +
      'Tören başlayınca sayfayı açık tutan herkes sahneyi görür. Toplar tek tek, "top çek" düğmesine her basışta sunucuda çekilir.\n\nBaşlatılsın mı?',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await startMundialDraw({ pots: drawPots, groupCount });
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
    setRehearsal(emptyDraw(drawPots, groupCount));
  };

  const startedAt = draw ? new Date(draw.createdAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const stageLabel = rehearsal
    ? 'PROVA KURA · KAYDEDİLMEZ, SADECE SENDE'
    : replayCursor !== null ? 'TEKRAR · KURA TÖRENİ'
      : complete ? 'BATAK MUNDIAL · KURA SONUCU' : '● CANLI · BATAK MUNDIAL KURA TÖRENİ';

  let controls: ReactNode = null;
  if (source && !complete && (rehearsal || liveCanAdvance)) {
    controls = (
      <>
        <NextBallButton draw={source} cursor={shown} disabled={advanceDisabled} onClick={() => void handleNext()} />
        <span className={styles.stageHint}>Boşluk tuşu da topu çeker.</span>
      </>
    );
  } else if (source && !complete && replayCursor === null) {
    controls = <span className={styles.stageHint}>Topları yöneticiler açıyor; ekran kendiliğinden güncellenir.</span>;
  }

  return (
    <div className="flex flex-col gap-4">
      {source && (
        <div ref={stageRef} className={styles.stageAnchor}>
          <DrawStage
            draw={source}
            cursor={shown}
            shaking={shaking}
            justOpened={justOpened}
            wildcards={wildcards}
            label={stageLabel}
            controls={controls}
          />
          <div className={styles.drawMeta}>
            <span>
              {rehearsal
                ? 'Bu bir prova: sonuç kaydedilmez, kimse görmez.'
                : draw && `Kura ${startedAt} tarihinde${draw.setByName ? ` ${draw.setByName} tarafından` : ''} başlatıldı; toplar sunucuda, tıklandığı anda çekildi.`}
            </span>
            <span className="flex flex-wrap items-center gap-3">
              {rehearsal ? (
                <button type="button" className={styles.ghostButton} onClick={() => setRehearsal(null)}>Provayı kapat</button>
              ) : draw ? (
                <>
                  {complete && replayCursor === null && (
                    <button type="button" className={styles.ghostButton} onClick={() => setReplayCursor(0)}>
                      <RotateCcw className="h-4 w-4" />Töreni tekrar izle
                    </button>
                  )}
                  {replayCursor !== null && (
                    <button type="button" className={styles.ghostButton} onClick={() => setReplayCursor(null)}>Tekrarı kapat</button>
                  )}
                  {canOperate && replayCursor === null && (
                    <button type="button" className={styles.dangerLink} onClick={handleReset} disabled={busy}>Kurayı sıfırla</button>
                  )}
                </>
              ) : null}
            </span>
          </div>
        </div>
      )}

      {!draw && !rehearsal && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}><Dices className="h-5 w-5" />Kura Çekimi</div>
          <p className={styles.muted}>
            Torbalar Superliga sezon sonu sıralamasına göre oluşturuldu (1-4 → 1. torba, 5-8 → 2. torba …).
            Tören başlayınca toplar tek tek açılır: önce torbadan bir oyuncu, sonra o oyuncunun grubu
            (o torbadan henüz oyuncu almamış gruplar arasından). Böylece her grupta her torbadan en fazla
            bir kişi olur. Her top, düğmeye basıldığı anda sunucuda çekilir; sayfayı açık tutan herkes
            aynı anda görür.
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
            {canOperate && (
              <button type="button" className={styles.primaryButton} onClick={handleStart} disabled={busy}>
                <Sparkles className="h-5 w-5" />{busy ? 'Başlatılıyor…' : 'Kura Törenini Başlat'}
              </button>
            )}
            <button type="button" className={styles.ghostButton} onClick={startRehearsal} disabled={busy}>
              <Eye className="h-4 w-4" />Prova kura (kaydedilmez)
            </button>
            {!canOperate && (
              <span className={styles.muted}>
                {user ? 'Töreni yöneticiler başlatacak; başlayınca bu sayfa kendiliğinden sahneye geçer.' : 'Giriş yaparsan töreni canlı izleyebilirsin.'}
              </span>
            )}
          </div>
        </div>
      )}

      {message && <p className={styles.message}>{message}</p>}
      {error && <p className={styles.errorMessage}>{error}</p>}
    </div>
  );
}
