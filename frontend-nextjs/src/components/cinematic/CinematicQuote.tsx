'use client';

import { QUOTES, useRotatingQuote } from '@/lib/clubQuotes';

/** The hero's rotating voice: all lines share one grid cell so the copy never shifts. */
export default function CinematicQuote() {
  const { index, shown } = useRotatingQuote();

  return <p className="cinema-quote-stage">
    {QUOTES.map((quote, i) => <span key={quote} className={`cinema-quote-line ${index === i && shown ? 'is-active' : ''}`} aria-hidden={index !== i}>
      <span className="cinema-quote-mark" aria-hidden="true">“</span>{quote}<span className="cinema-quote-mark" aria-hidden="true">”</span>
    </span>)}
  </p>;
}
