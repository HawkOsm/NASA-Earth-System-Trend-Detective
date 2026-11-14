import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { ChartData } from './analysis';

const GRID = '#1c2230';
const TICK = '#a8b0c0';

interface ChartProps {
  data: ChartData;
  units: string;
}

export default function Chart({ data, units }: ChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const opts: uPlot.Options = {
      width: Math.max(host.clientWidth, 200),
      height: 200,
      legend: { show: false },
      cursor: { show: false },
      select: { show: false, left: 0, top: 0, width: 0, height: 0 },
      scales: { x: { time: false, min: data.xMin, max: data.xMax } },
      axes: [
        {
          stroke: TICK,
          grid: { stroke: GRID, width: 1 },
          ticks: { stroke: GRID },
          font: '12px system-ui, sans-serif',
          incrs: [5, 10],
          values: (_u, vals) => vals.map((v) => String(Math.round(v))),
        },
        {
          stroke: TICK,
          grid: { stroke: GRID, width: 1 },
          ticks: { stroke: GRID },
          font: '12px system-ui, sans-serif',
          size: 46,
          values: (_u, vals) => vals.map((v) => (Math.abs(v) < 1e-9 ? '0' : String(+v.toPrecision(3)))),
        },
      ],
      series: [
        {},
        { label: 'Monthly', stroke: 'rgba(120, 170, 255, 0.35)', width: 1, spanGaps: true, points: { show: false } },
        {
          label: 'Annual',
          stroke: '#ffd166',
          width: 2.5,
          spanGaps: true,
          points: { show: true, size: 5, fill: '#ffd166', stroke: '#ffd166' },
        },
        { label: 'Trend', stroke: '#ffffff', width: 2, dash: [6, 5], points: { show: false } },
      ],
    };
    const plot = new uPlot(opts, [data.x, data.monthly, data.annual, data.trend], host);
    const ro = new ResizeObserver(() => plot.setSize({ width: Math.max(host.clientWidth, 200), height: 200 }));
    ro.observe(host);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  }, [data]);

  return (
    <div>
      <div className="chart-caption">Anomaly ({units}) relative to the {data.xMin}–{data.xMax - 1} average</div>
      <div ref={hostRef} className="chart-host" />
    </div>
  );
}
