"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Quote } from "lucide-react";

const QUOTES = [
  "Orda olduğumu nasıl biliyor???",
  "Ooo masada sikiş olmuş",
  "Kara Miraj…",
  "Beyler kaptan yok mu?",
  "En geç 22:30’da başlayalım",
  "Beyler akşama yokum, çocuğun waffle kursu var",
  "Balını sikiyim yaa",
  "Altın keleş, altın kalleş",
  "Krieg yasaklansın",
  "Kimse arkaya bakmıyor mu yaa???",
  "Beyler kaptanı dinleyin",
  "Serbest abi, isteyen istediğini yapsın",
  "Beyler info?",
  "Teknik mi Tarık mı?",
];
const ROTATION_MS = 3000;

export default function ClubQuotes() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (paused || !visible) return;
    const timer = setInterval(() => setIndex(current => (current + 1) % QUOTES.length), ROTATION_MS);
    return () => clearInterval(timer);
  }, [paused, visible]);

  return <div className="club-quotes">
    <p className="club-eyebrow"><Quote size={14} aria-hidden="true" /> CS BATAĞI / SESLİ SOHBETTEN</p>
    {/* All quotes occupy one grid cell: even the longest mobile quote reserves its height. */}
    <h1 className="club-quote-stage">
      {QUOTES.map((quote, i) => <span key={quote} className={`club-quote-line ${index === i ? 'is-active' : ''}`} aria-hidden={index !== i}>
        <span className="club-quote-mark" aria-hidden="true">“</span>{quote}<span className="club-quote-mark" aria-hidden="true">”</span>
      </span>)}
    </h1>
    <div className="club-quote-controls">
      <span className="club-quote-counter" aria-hidden="true">{String(index + 1).padStart(2, '0')} <span>/ {QUOTES.length}</span></span>
      <span className="club-quote-progress" aria-hidden="true"><span key={`${index}-${paused}-${visible}`} style={{ animationPlayState: paused || !visible ? 'paused' : 'running' }} /></span>
      <button type="button" onClick={() => setPaused(current => !current)} aria-label={paused ? 'Replikleri oynat' : 'Replikleri duraklat'} aria-pressed={paused} title={paused ? 'Replikleri oynat' : 'Replikleri duraklat'}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </div>
  </div>;
}
