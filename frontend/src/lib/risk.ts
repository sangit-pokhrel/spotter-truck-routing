import type { HeatMetric, RiskKey } from "../api/types";

export const RISK_ORDER: RiskKey[] = ["low", "moderate", "high", "severe", "no_travel"];

export const RISK_LABEL: Record<RiskKey, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
  no_travel: "No Travel",
  unknown: "No data",
};

/** Ordered low → no travel; heatmap ramps are built from these same colours. */
export const RISK_COLOR: Record<RiskKey, string> = {
  low: "#2f9e5b",
  moderate: "#e3b505",
  high: "#f07b1f",
  severe: "#d7382d",
  no_travel: "#7a2bb8",
  unknown: "#9aa3ad",
};

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Stop {
  value: number;
  rgb: RGB;
  alpha: number;
}

export interface MetricScale {
  label: string;
  unit: string;
  /** Values at which the colour reaches Moderate, High, Severe, No Travel (from the spec's table). */
  thresholds: [number, number, number, number];
  stops: Stop[];
}

function scale(label: string, unit: string, thresholds: MetricScale["thresholds"], zeroAlpha: number): MetricScale {
  const [m, h, s, n] = thresholds;
  return {
    label,
    unit,
    thresholds,
    stops: [
      { value: 0, rgb: hexToRgb(RISK_COLOR.low), alpha: zeroAlpha },
      { value: m, rgb: hexToRgb(RISK_COLOR.moderate), alpha: 0.55 },
      { value: h, rgb: hexToRgb(RISK_COLOR.high), alpha: 0.65 },
      { value: s, rgb: hexToRgb(RISK_COLOR.severe), alpha: 0.72 },
      { value: n, rgb: hexToRgb(RISK_COLOR.no_travel), alpha: 0.78 },
    ],
  };
}

export const METRIC_SCALES: Record<HeatMetric, MetricScale> = {
  risk: scale("Overall risk", "", [1, 2, 3, 4], 0.22),
  wind: scale("Wind", "mph", [25, 35, 45, 55], 0.18),
  rain: scale("Rain", "in/hr", [0.1, 0.25, 0.5, 1.0], 0),
  snow: scale("Snow", "in/hr", [0.5, 1.0, 2.0, 3.0], 0),
};

/** RGBA for a value, linearly interpolated between stops (continuous metrics stay smooth). */
export function colorFor(metric: HeatMetric, value: number): [number, number, number, number] {
  const { stops } = METRIC_SCALES[metric];
  if (value <= stops[0].value) return [...stops[0].rgb, stops[0].alpha];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (value <= b.value) {
      const t = (value - a.value) / (b.value - a.value);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
        a.alpha + (b.alpha - a.alpha) * t,
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [...last.rgb, last.alpha];
}
