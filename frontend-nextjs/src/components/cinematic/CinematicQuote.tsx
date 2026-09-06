'use client';

import { QUOTES, useRotatingQuote } from '@/lib/clubQuotes';
import { useEffect, useRef, useState } from 'react';

/** The hero's rotating voice: all lines share one grid cell so the copy never shifts. */
export default function CinematicQuote() {
  const element = useRef<HTMLParagraphElement>(null);
  const [enabled, setEnabled] = useState(false);
  const { index, shown } = useRotatingQuote(enabled);
  useEffect(() => {
    const shell = element.current?.closest('.cinema-shell');
    if (!shell) return;
    const sync = () => setEnabled(shell.getAttribute('data-motion') === 'on');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, { attributes: true, attributeFilter: ['data-motion'] });
    return () => observer.disconnect();
  }, []);

  return <p ref={element} className="cinema-quote-stage">
    {QUOTES.map((quote, i) => <span key={quote} className={`cinema-quote-line ${index === i && shown ? 'is-active' : ''}`} aria-hidden={index !== i}>
      <span className="cinema-quote-mark" aria-hidden="true">“</span>{quote}<span className="cinema-quote-mark" aria-hidden="true">”</span>
    </span>)}
  </p>;
}
