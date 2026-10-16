'use client';

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function HorizontalTableScroll({ children, label }: { children: ReactNode; label: string }) {
  const tableScroll = useRef<HTMLDivElement>(null);
  const topScroll = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; left: number } | null>(null);
  const mirroredPosition = useRef({ table: NaN, top: NaN });
  const [dragging, setDragging] = useState(false);
  const [range, setRange] = useState({ max: 0, atStart: true, atEnd: true });

  function updateRange() {
    const element = tableScroll.current;
    if (!element) return;
    const next = { max: Math.max(0, element.scrollWidth - element.clientWidth), atStart: element.scrollLeft <= 1, atEnd: element.scrollLeft >= element.scrollWidth - element.clientWidth - 1 };
    setRange(current => current.max === next.max && current.atStart === next.atStart && current.atEnd === next.atEnd ? current : next);
  }

  useEffect(() => {
    const element = tableScroll.current;
    if (!element) return;
    const observer = new ResizeObserver(updateRange);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    updateRange();
    return () => observer.disconnect();
  }, []);

  function scrollTo(left: number) {
    const element = tableScroll.current;
    if (!element) return;
    if (Math.abs(element.scrollLeft - left) > 1) element.scrollLeft = left;
    const actual = element.scrollLeft;
    mirroredPosition.current = { table: actual, top: actual };
    if (topScroll.current && Math.abs(topScroll.current.scrollLeft - actual) > 1) topScroll.current.scrollLeft = actual;
    updateRange();
  }

  function syncScroll(source: 'table' | 'top', element: HTMLDivElement) {
    const mirrored = mirroredPosition.current[source];
    mirroredPosition.current[source] = NaN;
    // Mirrored native scroll events must not overwrite a newer drag or button step.
    if (Math.abs(element.scrollLeft - mirrored) <= 1) return;
    scrollTo(element.scrollLeft);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    // Native touch scrolling and interactive table controls keep their existing behavior.
    if (event.pointerType !== 'mouse' || event.button !== 0 || element.scrollWidth <= element.clientWidth || !(event.target instanceof Element) || !event.target.closest('table') || event.target.closest('button,a,input,select,textarea,summary,[contenteditable]')) return;
    gesture.current = { id: event.pointerId, x: event.clientX, left: element.scrollLeft };
    element.setPointerCapture(event.pointerId);
    element.focus({ preventScroll: true });
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const distance = event.clientX - start.x;
    if (Math.abs(distance) >= 4) {
      setDragging(true);
      scrollTo(start.left - distance);
      event.preventDefault();
    }
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id !== event.pointerId) return;
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function step(direction: number) {
    const element = tableScroll.current;
    if (element) scrollTo(element.scrollLeft + direction * Math.max(240, element.clientWidth * .7));
  }

  return <div className={`night-horizontal-scroll${dragging ? ' is-dragging' : ''}`}>
    {range.max > 1 && <div className="night-scroll-tools" role="group" aria-label={`${label} yatay kaydırma kontrolleri`}>
      <span className="night-scroll-hint">Tut ve kaydır</span>
      <button type="button" aria-label={`${label}: sola kaydır`} disabled={range.atStart} onClick={() => step(-1)}><ChevronLeft size={20} /></button>
      <div className="night-scroll-track" ref={topScroll} role="region" aria-label={`${label} yatay kaydırma çubuğu`} tabIndex={0} onScroll={event => syncScroll('top', event.currentTarget)}><div style={{ width: `calc(100% + ${range.max}px)` }} /></div>
      <button type="button" aria-label={`${label}: sağa kaydır`} disabled={range.atEnd} onClick={() => step(1)}><ChevronRight size={20} /></button>
    </div>}
    <div className="night-table-scroll" ref={tableScroll} role="region" aria-label={label} tabIndex={0}
      onScroll={event => syncScroll('table', event.currentTarget)}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
      {children}
    </div>
  </div>;
}
