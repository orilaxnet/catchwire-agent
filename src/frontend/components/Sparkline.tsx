import { h } from 'preact';

interface SparklineProps {
  data:   number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 200, height = 40, color = 'var(--md-primary)' }: SparklineProps) {
  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1 || 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style="overflow:visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  );
}
