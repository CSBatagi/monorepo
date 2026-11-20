'use client';

import { useEffect, useRef, useState } from 'react';

/** Voice-chat lines shared by the club home heading and the cinematic hero. */
export const QUOTES = [
  "Beyler akşama yokum, çocuğun waffle kursu var",
  "Trakyalıyız ikimiz, keser sapı gibi sikimiz",
  "Masada sikmek sünnettir, Peygamberimiz de öyle yapardı",
  "Bu kadar gülecek ne vardı?",
];
export const QUOTE_FADE_MS = 1100;
const ROTATION_MS = 4200;

/** Cross-fades one quote at a time and pauses in hidden tabs. */
export function useRotatingQuote() {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [visible, setVisible] = useState(true);
  const remaining = useRef<number[]>([]);
  const previous = useRef(-1);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (!visible) return;
    let timer: ReturnType<typeof setTimeout>;
    const showNext = () => {
      if (!remaining.current.length) {
        const order = QUOTES.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        // Each quote plays once per shuffled round; no repeat between rounds.
        if (order[0] === previous.current) [order[0], order[1]] = [order[1], order[0]];
        remaining.current = order;
      }
      const next = remaining.current.shift()!;
      previous.current = next;
      setIndex(next);
      setShown(true);
      timer = setTimeout(() => {
        setShown(false);
        timer = setTimeout(showNext, QUOTE_FADE_MS);
      }, ROTATION_MS - QUOTE_FADE_MS);
    };
    showNext();
    return () => clearTimeout(timer);
  }, [visible]);

  return { index, shown };
}
