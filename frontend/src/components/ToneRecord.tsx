import { useEffect, useRef, useState } from "react";
import { formatMetric, percent } from "../lib/format";

/** The record: every UN statement of the baseline years in bands of tone balance (−1 all hostile, +1 all
 *  cooperative), with this text marked among them and the UN average as a dashed line. */
export default function ToneRecord({ histogram, value, average, years, shareBelow }: {
  histogram: number[]; value: number; average?: number | null; years: string; shareBelow: number;
}) {
  // Drawn at the figure's real width, so the labels keep their shape at any screen size
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 110;
  const top = 22;
  const base = H - 22;
  const max = Math.max(1, ...histogram);
  // The bars' own total: a statement without hostile or cooperative words has no tone balance
  const counted = histogram.reduce((sum, n) => sum + n, 0);
  const band = W / histogram.length;
  const at = (v: number) => ((Math.max(-1, Math.min(1, v)) + 1) / 2) * W;
  const x = at(value);
  const anchor = x > W - 70 ? "end" : x < 70 ? "start" : "middle";
  const hasAverage = typeof average === "number";
  return (
    <figure className="tone-record" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`Tone balance of ${counted.toLocaleString()} UN General Debate statements, ${years}: this text, `
          + `${formatMetric("tone_balance", value)}, is higher than ${percent(shareBelow)} of them.`
          + (hasAverage ? ` The UN average is ${formatMetric("tone_balance", average)}.` : "")}>
        {histogram.map((n, i) => {
          const h = ((base - top) * n) / max;
          // red, grey and blue around zero, split where the verdict's words change (±0.1)
          const centre = -1 + ((i + 0.5) * 2) / histogram.length;
          const side = centre <= -0.1 ? " neg" : centre >= 0.1 ? " pos" : "";
          return <rect key={i} className={`tone-record-bar${side}`} x={i * band + 1} y={base - h} width={band - 2} height={h} />;
        })}
        <line className="tone-record-zero" x1={W / 2} x2={W / 2} y1={base} y2={base + 5} />
        {hasAverage && <line className="tone-record-avg" x1={at(average)} x2={at(average)} y1={top - 4} y2={base} />}
        <line className="tone-record-mark" x1={x} x2={x} y1={top - 6} y2={base} />
        <text className="tone-record-label" x={x} y={top - 10} textAnchor={anchor}>This text</text>
        <text className="tone-record-axis" x={0} y={H - 4} textAnchor="start">−1 all hostile</text>
        <text className="tone-record-axis" x={W / 2} y={H - 4} textAnchor="middle">0</text>
        <text className="tone-record-axis" x={W} y={H - 4} textAnchor="end">+1 all cooperative</text>
      </svg>
      <figcaption className="small muted">
        Each bar counts the UN statements of {years} with that tone balance, red where they lean confrontational and
        blue where they lean conciliatory. The blue line marks this text
        {hasAverage ? <>, the dashed line the UN average ({formatMetric("tone_balance", average)})</> : null}.
      </figcaption>
    </figure>
  );
}
