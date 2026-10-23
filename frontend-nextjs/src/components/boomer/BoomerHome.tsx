"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, CircleHelp, Swords, X } from "lucide-react";
import players from "../../../public/data/players.json";
import { useSession } from "@/contexts/SessionContext";
import { useLivePolling } from "@/lib/useLivePolling";
import { useAttendanceWriter } from "@/lib/useAttendanceWriter";
import TeamSpeakConnect from "../TeamSpeakConnect";

const TEKER_DONDU_THRESHOLD = 10;
const choices = [
  { status: "coming", label: "Geliyorum", icon: Check },
  { status: "not_coming", label: "Gelmiyorum", icon: X },
  { status: "uncertain", label: "Belirsiz", icon: CircleHelp },
];

export default function BoomerHome() {
  const { user, ready } = useSession();
  const writeAttendance = useAttendanceWriter();
  const { data, loading, error, refetch } = useLivePolling<{ attendance: Record<string, { status: string }> }>({
    url: '/api/live/attendance', enabled: !!user, initialData: { attendance: {} },
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const statuses = Object.values(data.attendance);
  const coming = statuses.filter(player => player.status === 'coming').length;
  const uncertain = statuses.filter(player => player.status === 'uncertain').length;
  const available = !!user && !loading && !error;
  const me = user ? players.find(player => player.steamId === user.steamId) : undefined;
  const mine = me ? data.attendance[me.steamId]?.status : undefined;

  const choose = async (status: string) => {
    if (!me || saving) return;
    setSaving(status); setFailed(false);
    try {
      await writeAttendance(me.steamId, me.name, status);
      await refetch();
    } catch (failure) {
      console.error("Error syncing attendance:", failure);
      setFailed(true);
    } finally {
      setSaving(null);
    }
  };

  return <div className="boomer-home">
    <section className="boomer-card" aria-labelledby="boomer-tonight">
      <p className="boomer-eyebrow" id="boomer-tonight">BU AKŞAM</p>
      <div className="boomer-count">
        <strong className={available ? '' : 'is-pending'}>{available ? coming : '0'}</strong>
        <span>kişi geliyor{available && uncertain > 0 && <small>{uncertain} kişi belirsiz</small>}</span>
      </div>
      <div className="boomer-progress" aria-hidden="true"><i style={{ width: `${available ? Math.min(coming / TEKER_DONDU_THRESHOLD, 1) * 100 : 0}%` }} /></div>
      <p className="boomer-teker">{error ? 'Katılım yüklenemedi. Sayfayı yenile.' : !available ? 'Katılım yükleniyor…'
        : coming >= TEKER_DONDU_THRESHOLD ? 'Teker döndü! Maç var.' : `Tekerin dönmesine ${TEKER_DONDU_THRESHOLD - coming} kişi kaldı.`}</p>

      <h2>Sen geliyor musun?</h2>
      {me ? <div className="boomer-choices" role="group" aria-label="Katılım durumun">
        {choices.map(({ status, label, icon: Icon }) => <button key={status} data-status={status}
          className={mine === status ? 'is-selected' : ''} aria-pressed={mine === status}
          disabled={!!saving || !available} onClick={() => void choose(status)}>
          <Icon size={22} strokeWidth={2.4} />{saving === status ? 'Kaydediliyor…' : label}
        </button>)}
      </div> : !ready ? null : user ? <p className="boomer-note">Steam hesabın oyuncu listesinde yok. Bir yöneticiye yaz.</p>
        : <Link prefetch={false} className="boomer-button" href="/login">Steam ile giriş yap</Link>}
      {failed && <p className="boomer-note is-error" role="alert">Kaydedilemedi. Tekrar dene.</p>}
      <Link prefetch={false} href="/attendance" className="boomer-link">Kim geliyor, listeye bak <ArrowRight size={18} /></Link>
    </section>

    <Link prefetch={false} href="/team-picker" className="boomer-card boomer-teams">
      <span className="boomer-teams-icon"><Swords size={26} /></span>
      <span><strong>Takımları seç</strong><small>Gelenleri iki takıma ayır.</small></span>
      <ArrowRight size={22} />
    </Link>

    <TeamSpeakConnect />
  </div>;
}
