import { useEffect, useState } from "react";
import type { HeatMetric } from "../api/types";
import { formatEta } from "../lib/format";
import { METRIC_SCALES, RISK_COLOR, RISK_LABEL, RISK_ORDER, colorFor } from "../lib/risk";

interface Props {
  start: string;
  hours: number;
  hour: number;
  onHour: (hour: number) => void;
  /** Advance one hour (wrapping); used by the play animation. */
  onStep: () => void;
  metric: HeatMetric;
  onMetric: (metric: HeatMetric) => void;
  loading: boolean;
  error: string | null;
}

const METRICS: HeatMetric[] = ["risk", "wind", "rain", "snow"];
const PLAY_STEP_MS = 450;

function Legend({ metric }: { metric: HeatMetric }) {
  if (metric === "risk") {
    return (
      <div className="legend">
        {RISK_ORDER.map((k) => (
          <span key={k}>
            <i style={{ background: RISK_COLOR[k] }} />
            {RISK_LABEL[k]}
          </span>
        ))}
      </div>
    );
  }
  const { thresholds, unit } = METRIC_SCALES[metric];
  const max = thresholds[3];
  const stops = Array.from({ length: 11 }, (_, i) => {
    const [r, g, b, a] = colorFor(metric, (max * i) / 10);
    return `rgba(${r},${g},${b},${Math.max(a, 0.1)}) ${i * 10}%`;
  });
  return (
    <div className="legend legend-scale" aria-label={`${METRIC_SCALES[metric].label} scale in ${unit}`}>
      <div className="legend-gradient" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="legend-ticks">
        {thresholds.map((t) => (
          <span key={t} style={{ left: `${(t / max) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <span className="legend-unit">{unit}</span>
    </div>
  );
}

export function ForecastBar({ start, hours, hour, onHour, onStep, metric, onMetric, loading, error }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(onStep, PLAY_STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, onStep]);

  const disabled = loading || !!error;
  const at = new Date(new Date(start).getTime() + hour * 3600_000).toISOString();

  return (
    <div className="forecast">
      <div className="forecast-left">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying((p) => !p)}
          disabled={disabled}
          aria-label={playing ? "Pause forecast animation" : "Play forecast animation"}
        >
          {playing ? (
            <svg viewBox="0 0 12 12" aria-hidden>
              <rect x="2" y="1.5" width="3" height="9" />
              <rect x="7" y="1.5" width="3" height="9" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" aria-hidden>
              <path d="M3 1.5v9l7.5-4.5z" />
            </svg>
          )}
        </button>
        <div className="forecast-time">
          <b>+{String(hour).padStart(2, "0")}h</b>
          <span>{formatEta(at)}</span>
        </div>
      </div>

      <input
        className="slider"
        type="range"
        min={0}
        max={hours}
        step={1}
        value={hour}
        onChange={(e) => {
          setPlaying(false);
          onHour(Number(e.target.value));
        }}
        disabled={disabled}
        aria-label="Forecast hour after departure"
        aria-valuetext={`Departure plus ${hour} hours`}
      />

      <div className="forecast-right">
        <div className="seg seg-sm" role="radiogroup" aria-label="Heatmap layer">
          {METRICS.map((m) => (
            <label key={m} className={metric === m ? "on" : undefined}>
              <input type="radio" name="metric" checked={metric === m} onChange={() => onMetric(m)} />
              {m === "risk" ? "Risk" : METRIC_SCALES[m].label}
            </label>
          ))}
        </div>
        {loading ? (
          <span className="muted small">Loading corridor forecast…</span>
        ) : error ? (
          <span className="error-text small">Heatmap unavailable: {error}</span>
        ) : (
          <Legend metric={metric} />
        )}
      </div>
    </div>
  );
}
