import { useState } from 'react';

// Small dependency-free SVG charts for the Torre. Current period in the accent blue,
// the reference (prior year or goal) in grey; one axis, hairline grid, sparing labels.

export type ChartSeries = { name: string; values: Array<number | null>; tone: 'accent' | 'reference' };

const WIDTH = 520;
const HEIGHT = 210;
const PAD = { top: 22, right: 12, bottom: 28, left: 58 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

// Round tick step (1, 2, 2.5, 5 × 10^n) so the axis reads in clean numbers.
function niceTicks(min: number, max: number, count = 4) {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const span = high - low || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(value => value >= raw) || raw;
  const start = Math.floor(low / step) * step;
  const end = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function finite(values: Array<number | null>) {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

function Legend({ series, extra }: { series: ChartSeries[]; extra?: string | null }) {
  return <div className="siio-chart-legend">
    {series.map(item => <span key={item.name}><i className={`siio-chart-key siio-chart-key-${item.tone}`} />{item.name}</span>)}
    {extra ? <span><i className="siio-chart-key siio-chart-key-goal" />{extra}</span> : null}
  </div>;
}

function Tooltip({ text, x }: { text: string | null; x: number }) {
  if (!text) return null;
  return <div className="siio-chart-tooltip" style={{ left: `${(x / WIDTH) * 100}%` }} role="status">{text}</div>;
}

export function SiioColumnChart({ title, note, categories, series, format, axisFormat, goal, goalLabel, labelAll = true }: {
  title: string;
  note?: string;
  categories: string[];
  series: ChartSeries[];
  format: (value: number) => string;
  axisFormat: (value: number) => string;
  goal?: number | null;
  goalLabel?: string;
  labelAll?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = [...series.flatMap(item => finite(item.values)), ...(goal ? [goal] : [])];
  if (!values.length) return null;
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const y = (value: number) => PAD.top + PLOT_H - ((value - low) / (high - low || 1)) * PLOT_H;
  const band = PLOT_W / categories.length;
  const barWidth = Math.min(24, (band * 0.7) / series.length);
  const groupWidth = barWidth * series.length + 2 * (series.length - 1);
  const accent = series.find(item => item.tone === 'accent');
  const accentValues = accent ? finite(accent.values) : [];
  const peak = accentValues.length ? Math.max(...accentValues) : null;
  const lastIndex = accent ? accent.values.map((value, index) => (value === null ? -1 : index)).filter(index => index >= 0).pop() ?? -1 : -1;
  const tooltip = active === null ? null : `${categories[active]} · ${series.map(item => `${item.name}: ${item.values[active] === null ? '—' : format(item.values[active] as number)}`).join(' · ')}${goal ? ` · ${goalLabel || 'Meta'}: ${format(goal)}` : ''}`;
  const roundedTop = (x: number, top: number, bottom: number, width: number) => {
    // 4px rounded data end, square at the baseline; negative bars round at the bottom.
    const r = Math.min(4, Math.abs(bottom - top) / 2, width / 2);
    if (top <= bottom) return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
    return `M${x},${bottom} V${top - r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top - r} V${bottom} Z`;
  };

  return <figure className="siio-chart">
    <figcaption><strong>{title}</strong>{note ? <span>{note}</span> : null}</figcaption>
    <Legend series={series} extra={goal ? goalLabel || 'Meta' : null} />
    <div className="siio-chart-frame" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}. ${categories.map((category, index) => `${category}: ${series.map(item => `${item.name} ${item.values[index] === null ? 'sin dato' : format(item.values[index] as number)}`).join(', ')}`).join('; ')}`}>
        {ticks.map(tick => <g key={tick}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'siio-chart-baseline' : 'siio-chart-grid'} />
          <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="siio-chart-axis">{axisFormat(tick)}</text>
        </g>)}
        {goal ? <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(goal)} y2={y(goal)} className="siio-chart-goal" /> : null}
        {categories.map((category, index) => {
          const center = PAD.left + band * index + band / 2;
          const start = center - groupWidth / 2;
          return <g key={category} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} tabIndex={0} className={active === index ? 'siio-chart-active' : undefined}>
            <rect x={PAD.left + band * index} y={PAD.top} width={band} height={PLOT_H} className="siio-chart-hit" />
            {series.map((item, seriesIndex) => {
              const value = item.values[index];
              if (value === null || !Number.isFinite(value)) return null;
              const x = start + seriesIndex * (barWidth + 2);
              const showLabel = item.tone === 'accent' && (labelAll || value === peak || index === lastIndex);
              return <g key={item.name}>
                <path d={roundedTop(x, y(value), y(0), barWidth)} className={`siio-chart-bar siio-chart-${item.tone}`} />
                {showLabel ? <text x={x + barWidth / 2} y={value >= 0 ? y(value) - 6 : y(value) + 14} textAnchor="middle" className="siio-chart-value">{format(value)}</text> : null}
              </g>;
            })}
            <text x={center} y={HEIGHT - 8} textAnchor="middle" className="siio-chart-axis">{category}</text>
          </g>;
        })}
      </svg>
      <Tooltip text={tooltip} x={active === null ? 0 : PAD.left + band * active + band / 2} />
    </div>
  </figure>;
}

export function SiioLineChart({ title, note, categories, series, format, axisFormat }: {
  title: string;
  note?: string;
  categories: string[];
  series: ChartSeries[];
  format: (value: number) => string;
  axisFormat: (value: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const values = series.flatMap(item => finite(item.values));
  if (!values.length) return null;
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const y = (value: number) => PAD.top + PLOT_H - ((value - low) / (high - low || 1)) * PLOT_H;
  const band = PLOT_W / categories.length;
  const x = (index: number) => PAD.left + band * index + band / 2;
  const tooltip = active === null ? null : `${categories[active]} · ${series.map(item => `${item.name}: ${item.values[active] === null ? '—' : format(item.values[active] as number)}`).join(' · ')}`;
  // Reference first so the current year draws on top.
  const ordered = [...series].sort((a, b) => (a.tone === 'reference' ? -1 : 1) - (b.tone === 'reference' ? -1 : 1));

  return <figure className="siio-chart">
    <figcaption><strong>{title}</strong>{note ? <span>{note}</span> : null}</figcaption>
    <Legend series={series} />
    <div className="siio-chart-frame" onMouseLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}. ${categories.map((category, index) => `${category}: ${series.map(item => `${item.name} ${item.values[index] === null ? 'sin dato' : format(item.values[index] as number)}`).join(', ')}`).join('; ')}`}>
        {ticks.map(tick => <g key={tick}>
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'siio-chart-baseline' : 'siio-chart-grid'} />
          <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="siio-chart-axis">{axisFormat(tick)}</text>
        </g>)}
        {active !== null ? <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + PLOT_H} className="siio-chart-crosshair" /> : null}
        {ordered.map(item => {
          const points = item.values.map((value, index) => (value === null ? null : `${x(index)},${y(value)}`)).filter(Boolean).join(' ');
          return <g key={item.name}>
            <polyline points={points} className={`siio-chart-line siio-chart-${item.tone}`} />
            {item.values.map((value, index) => value === null ? null : <circle key={index} cx={x(index)} cy={y(value)} r={item.tone === 'accent' ? 4.5 : 3.5} className={`siio-chart-dot siio-chart-${item.tone}`} />)}
            {item.tone === 'accent' ? item.values.map((value, index) => value === null ? null : <text key={`l${index}`} x={x(index)} y={value < 0 ? y(value) + 18 : y(value) - 10} textAnchor="middle" className="siio-chart-value">{format(value)}</text>) : null}
          </g>;
        })}
        {categories.map((category, index) => <g key={category} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} tabIndex={0}>
          <rect x={PAD.left + band * index} y={PAD.top} width={band} height={PLOT_H} className="siio-chart-hit" />
          <text x={x(index)} y={HEIGHT - 8} textAnchor="middle" className="siio-chart-axis">{category}</text>
        </g>)}
      </svg>
      <Tooltip text={tooltip} x={active === null ? 0 : x(active)} />
    </div>
  </figure>;
}
