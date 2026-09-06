"use client";

import { Quote } from "lucide-react";
import { QUOTES, useRotatingQuote } from "@/lib/clubQuotes";

export default function ClubQuotes() {
  const { index, shown } = useRotatingQuote();

  return <div className="club-quotes">
    <p className="club-eyebrow"><Quote size={14} aria-hidden="true" /> CS BATAĞI / TOPLANIN</p>
    {/* All quotes occupy one grid cell: even the longest mobile quote reserves its height. */}
    <h1 className="club-quote-stage">
      {QUOTES.map((quote, i) => <span key={quote} className={`club-quote-line ${index === i && shown ? 'is-active' : ''}`} aria-hidden={index !== i}>
        <span className="club-quote-mark" aria-hidden="true">“</span>{quote}<span className="club-quote-mark" aria-hidden="true">”</span>
      </span>)}
    </h1>
  </div>;
}
