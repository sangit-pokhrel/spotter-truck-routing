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
  spacingMi: number | null;
}

const METRICS: HeatMetric[] = ["risk", "wind", "rain", "snow"];
const PLAY_STEP_MS = 450;

function Legend({ metric }: { metric: HeatMetric }) {
  if (metric === "risk") {
    return (
      <div className="legend">
        {RISK_ORDER.map((k) => (
          <span key={k} className="legend-item">
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
    return `rgba(${r},${g},${b},${Math.max(a, 0.08)}) ${i * 10}%`;
  });
  return (
    <div className="legend legend-scale">
      <div className="legend-gradient" style={{ background: `linear-gradient(90deg, ${stops.join(",")})` }} />
      <div className="legend-ticks">
        <span>0</span>
        {thresholds.map((t) => (
          <span key={t} style={{ left: `${(t / max) * 100}%` }}>
            {t}
          </span>
        ))}
        <em>{unit}</em>
      </div>
    </div>
  );
}

export function ForecastBar({ start, hours, hour, onHour, onStep, metric, onMetric, loading, error, spacingMi }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(onStep, PLAY_STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, onStep]);

  const at = new Date(new Date(start).getTime() + hour * 3600_000).toISOString();

  return (
    <section className="forecast-bar" aria-label="Weather forecast heatmap">
      <div className="forecast-row">
        <div className="segmented small" role="radiogroup" aria-label="Heatmap layer">
          {METRICS.map((m) => (
            <label key={m} className={metric === m ? "selected" : undefined}>
              <input type="radio" name="metric" checked={metric === m} onChange={() => onMetric(m)} />
              {METRIC_SCALES[m].label}
            </label>
          ))}
        </div>
        <Legend metric={metric} />
      </div>
      <div className="forecast-row">
        <button
          type="button"
          className="play"
          onClick={() => setPlaying((p) => !p)}
          disabled={loading || !!error}
          aria-label={playing ? "Pause forecast animation" : "Play forecast animation"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
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
          disabled={loading || !!error}
          aria-label="Forecast hour after departure"
          aria-valuetext={`Departure plus ${hour} hours`}
        />
        <div className="forecast-time">
          <strong>+{hour}h</strong>
          <span>{formatEta(at)}</span>
        </div>
      </div>
      <div className="forecast-note">
        {loading
          ? "Loading corridor forecast…"
          : error
            ? `Heatmap unavailable: ${error}`
            : `Forecast 0–${hours}h after departure across an 80-mile-wide corridor (${spacingMi ?? "–"} mi cells). The truck marker shows where the selected route puts you at that hour.`}
      </div>
    </section>
  );
}
