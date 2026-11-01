import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice } from '../lib/format.js';

const STEP = 8; // pixels per 5-minute bar
const H = 250;
const PAD = { top: 18, bottom: 22 };
const clock = (sec) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sec * 1000));
const dayLabel = (sec) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(sec * 1000));
const dayKey = (sec) => new Date((sec + 19800) * 1000).toISOString().slice(0, 10);

/**
 * One trade as a picture you can scroll sideways with your finger: the earlier session and the whole day as candles, the entry, the stop, the exit,
 * and a shaded band for the time it was held. It is plain SVG in a scrolling box, so going back to an earlier time is just a drag.
 * `bars`: [{ time, open, high, low, close }] oldest first. `trade`: { side, entryTime, exitTime, entrySpot, exitSpot, stop, net, label, exitLabel }.
 */
export function TradeChart({ bars, trade }) {
  const box = useRef(null);
  const [tap, setTap] = useState(null);
  const view = useMemo(() => {
    const lo = Math.min(...bars.map((b) => b.low), trade.stop, trade.entrySpot, trade.exitSpot);
    const hi = Math.max(...bars.map((b) => b.high), trade.stop, trade.entrySpot, trade.exitSpot);
    const pad = (hi - lo) * 0.06 || 1;
    const min = lo - pad;
    const max = hi + pad;
    const y = (v) => PAD.top + ((max - v) / (max - min)) * (H - PAD.top - PAD.bottom);
    const x = (t) => {
      // the bar a moment falls in: its centre
      let i = bars.findIndex((b) => b.time + 300 > t);
      if (i < 0) i = bars.length - 1;
      return i * STEP + STEP / 2;
    };
    const ticks = [];
    for (let i = 0; i < 10; i += 1) ticks.push(min + ((max - min) * i) / 9);
    return { min, max, y, x, ticks };
  }, [bars, trade]);
  const width = bars.length * STEP + 24;

  // open with the entry in view, so the earlier bars are to the left, one drag away
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = Math.max(0, view.x(trade.entryTime) - 90);
  }, [view, trade.entryTime]);

  const up = 'var(--up)';
  const down = 'var(--down)';
  const call = trade.side === 'CE';
  const won = trade.net > 0;
  const ex = view.x(trade.exitTime - 60);
  const en = view.x(trade.entryTime);
  const shown = tap != null ? bars[tap] : null;

  return (
    <div className="space-y-1">
      <div className="num flex min-h-4 flex-wrap gap-x-3 text-[10px] text-muted">
        {shown ? (
          <>
            <span>{dayLabel(shown.time)} {clock(shown.time)}</span>
            <span>O {formatPrice(shown.open)}</span>
            <span>H {formatPrice(shown.high)}</span>
            <span>L {formatPrice(shown.low)}</span>
            <span>C {formatPrice(shown.close)}</span>
          </>
        ) : (
          <span>Drag sideways to look at earlier or later times. Tap a candle for its prices.</span>
        )}
      </div>
      <div className="flex rounded-xl border border-line bg-surface-2/40">
        <div className="num relative w-12 shrink-0 text-[9px] text-muted" style={{ height: H }} aria-hidden="true">
          {view.ticks.map((v) => (
            <span key={v} className="absolute right-1 -translate-y-1/2" style={{ top: view.y(v) }}>{Math.round(v)}</span>
          ))}
        </div>
        <div ref={box} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain" style={{ touchAction: 'pan-x pan-y' }}>
          <svg width={width} height={H} role="img" aria-label={`${call ? 'Call' : 'Put'} bought at ${clock(trade.entryTime)} and sold at ${clock(trade.exitTime)}`}>
            {view.ticks.map((v) => (
              <line key={v} x1="0" x2={width} y1={view.y(v)} y2={view.y(v)} stroke="var(--border)" strokeWidth="0.5" />
            ))}
            <rect x={Math.min(en, ex)} y={PAD.top} width={Math.max(Math.abs(ex - en), 3)} height={H - PAD.top - PAD.bottom} fill={won ? up : down} opacity="0.1" />
            {bars.map((b, i) => {
              const cx = i * STEP + STEP / 2;
              const col = b.close >= b.open ? up : down;
              const top = view.y(Math.max(b.open, b.close));
              const bottom = view.y(Math.min(b.open, b.close));
              const newDay = i > 0 && dayKey(b.time) !== dayKey(bars[i - 1].time);
              return (
                <g key={b.time} onClick={() => setTap(tap === i ? null : i)}>
                  {newDay && (
                    <>
                      <line x1={i * STEP} x2={i * STEP} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeDasharray="2 3" strokeWidth="0.7" />
                      <text x={i * STEP + 3} y={PAD.top - 5} fontSize="9" fill="var(--muted)">{dayLabel(b.time)}</text>
                    </>
                  )}
                  <rect x={i * STEP} y={PAD.top} width={STEP} height={H - PAD.top - PAD.bottom} fill="transparent" />
                  <line x1={cx} x2={cx} y1={view.y(b.high)} y2={view.y(b.low)} stroke={col} strokeWidth="1" />
                  <rect x={cx - 2.5} y={top} width="5" height={Math.max(bottom - top, 1)} fill={col} />
                  {i % 6 === 0 && <text x={cx} y={H - 7} fontSize="8.5" textAnchor="middle" fill="var(--muted)">{clock(b.time)}</text>}
                </g>
              );
            })}
            <line x1="0" x2={width} y1={view.y(trade.entrySpot)} y2={view.y(trade.entrySpot)} stroke="var(--accent)" strokeDasharray="4 3" strokeWidth="1" />
            <text x={width - 4} y={view.y(trade.entrySpot) - 3} fontSize="9" textAnchor="end" fill="var(--accent)">Entry {formatPrice(trade.entrySpot)}</text>
            <line x1="0" x2={width} y1={view.y(trade.stop)} y2={view.y(trade.stop)} stroke={down} strokeDasharray="4 3" strokeWidth="1" />
            <text x={width - 4} y={view.y(trade.stop) + (call ? 11 : -3)} fontSize="9" textAnchor="end" fill={down}>Stop {formatPrice(trade.stop)}</text>
            <path d={call ? `M${en},${view.y(trade.entrySpot) + 14} l-6,10 h12 z` : `M${en},${view.y(trade.entrySpot) - 14} l-6,-10 h12 z`} fill="var(--accent)" />
            <text x={en} y={call ? view.y(trade.entrySpot) + 38 : view.y(trade.entrySpot) - 30} fontSize="9.5" fontWeight="600" textAnchor="middle" fill="var(--accent)">{trade.label}</text>
            <circle cx={ex} cy={view.y(trade.exitSpot)} r="5" fill={won ? up : down} stroke="var(--bg, #000)" strokeWidth="1.5" />
            <text x={ex} y={view.y(trade.exitSpot) + (call === won ? -10 : 16)} fontSize="9.5" fontWeight="600" textAnchor="middle" fill={won ? up : down}>{trade.exitLabel}</text>
          </svg>
        </div>
      </div>
    </div>
  );
}
