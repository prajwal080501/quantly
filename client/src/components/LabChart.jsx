import { useEffect, useRef } from 'react';
import { createChart, createSeriesMarkers, LineSeries, ColorType, CrosshairMode } from 'lightweight-charts';
import { toChartTime } from '../lib/chart.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { snapTime } from './DayChart.jsx';

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * The index over weeks as one line (5-minute closes), with an arrow at every entry. Fits the whole period on screen; pinch or drag to look closer.
 * `candles`: [{ time, close }] in epoch seconds. `markers`: [{ id, time, position, shape, color, text, size }]. `onPick(id)` when an arrow's bar is tapped.
 */
export function LabChart({ candles, markers, onPick, height = 260 }) {
  const { theme } = useTheme();
  const el = useRef(null);
  const live = useRef({});
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!el.current || !candles.length) return undefined;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: cssVar('--muted'), fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--border') } },
      rightPriceScale: { borderVisible: false, minimumWidth: 52 },
      timeScale: { borderVisible: false, timeVisible: false, minBarSpacing: 0.02, rightOffset: 2 },
      crosshair: { mode: CrosshairMode.Magnet },
      kineticScroll: { touch: true, mouse: false },
      handleScroll: { horzTouchDrag: true, pressedMouseMove: true, vertTouchDrag: false },
    });
    const series = chart.addSeries(LineSeries, { color: cssVar('--accent'), lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const bars = candles.map((c) => ({ time: toChartTime(c.time), value: c.close }));
    series.setData(bars);
    chart.timeScale().fitContent();
    const times = bars.map((b) => b.time);
    chart.subscribeClick((p) => {
      if (p.time == null) return;
      // the nearest arrow within a few bars of the tap
      const near = (live.current.markers ?? []).map((m) => ({ id: m.id, d: Math.abs(snapTime(times, toChartTime(m.time)) - p.time) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d <= 3 * 3600) pick.current?.(near.id);
    });
    live.current = { ...live.current, series, times, marks: createSeriesMarkers(series, []) };
    return () => {
      chart.remove();
      live.current = { markers: live.current.markers };
    };
  }, [candles, theme]);

  useEffect(() => {
    const { marks, times } = live.current;
    live.current.markers = markers;
    if (!marks) return;
    marks.setMarkers(markers.map((m) => ({ time: snapTime(times, toChartTime(m.time)), position: m.position, shape: m.shape, color: m.color, size: m.size ?? 1, text: m.text })).sort((a, b) => a.time - b.time));
  }, [markers, candles, theme]);

  return <div ref={el} style={{ height }} className="w-full" role="img" aria-label="The index over the period with an arrow at every entry" />;
}
