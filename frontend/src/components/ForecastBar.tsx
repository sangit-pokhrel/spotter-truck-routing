import { useEffect, useMemo, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { HeatMetric } from "../api/types";
import { formatEta } from "../lib/format";
import { METRIC_SCALES, RISK_COLOR, RISK_LABEL, RISK_ORDER, colorFor } from "../lib/risk";
import { PauseIcon, PlayIcon } from "./icons";

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

/** A tick every 12 hours: 0h, 12h, 24h, 36h, 48h. */
function marksFor(hours: number) {
  return Array.from({ length: Math.floor(hours / 12) + 1 }, (_, i) => ({ value: i * 12, label: `${i * 12}h` }));
}

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

  const marks = useMemo(() => marksFor(hours), [hours]);
  const disabled = loading || !!error;
  const at = new Date(new Date(start).getTime() + hour * 3600_000).toISOString();

  return (
    <div className="forecast">
      <div className="forecast-left">
        <IconButton
          className="play"
          onClick={() => setPlaying((p) => !p)}
          disabled={disabled}
          aria-label={playing ? "Pause forecast animation" : "Play forecast animation"}
        >
          {playing ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
        </IconButton>
        <div className="forecast-time">
          <b>+{String(hour).padStart(2, "0")}h</b>
          <span>{formatEta(at)}</span>
        </div>
      </div>

      <Slider
        className="slider"
        size="small"
        min={0}
        max={hours}
        step={1}
        marks={marks}
        value={hour}
        onChange={(_, value) => {
          setPlaying(false);
          onHour(value as number);
        }}
        disabled={disabled}
        aria-label="Forecast hour after departure"
        getAriaValueText={(h) => `Departure plus ${h} hours`}
        valueLabelDisplay="auto"
        valueLabelFormat={(h) => `+${h}h`}
      />

      <div className="forecast-right">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={metric}
          onChange={(_, m: HeatMetric | null) => m && onMetric(m)}
          aria-label="Heatmap layer"
        >
          {METRICS.map((m) => (
            <ToggleButton key={m} value={m}>
              {m === "risk" ? "Risk" : METRIC_SCALES[m].label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
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
