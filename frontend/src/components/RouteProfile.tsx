import { memo, useMemo, useRef } from "react";
import type { RiskKey, RouteOption } from "../api/types";
import { formatEta, formatMiles } from "../lib/format";
import { checkpointAtMile, mileAtHour } from "../lib/geo";
import { RISK_COLOR, RISK_LABEL } from "../lib/risk";

interface Props {
  route: RouteOption;
  hour: number;
  hoveredMile: number | null;
  onHoverMile: (mile: number | null) => void;
}

interface Band {
  from: number;
  to: number;
  level: RiskKey;
}

/** Road split into stretches by the checkpoint that represents them (same as the backend). */
function bands(route: RouteOption): Band[] {
  const out: Band[] = [];
  let from = 0;
  for (const cp of route.checkpoints) {
    const to = from + cp.coverage_mi;
    const last = out[out.length - 1];
    if (last && last.level === cp.level) last.to = to;
    else out.push({ from, to, level: cp.level });
    from = to;
  }
  return out;
}

function hourStep(duration: number): number {
  if (duration <= 6) return 1;
  if (duration <= 16) return 2;
  if (duration <= 36) return 4;
  return 8;
}

const pct = (mile: number, total: number) => `${(Math.min(Math.max(mile / total, 0), 1) * 100).toFixed(3)}%`;

/** Weather along the selected route, laid out by road mile with ETA ticks. */
export const RouteProfile = memo(function RouteProfile({ route, hour, hoveredMile, onHoverMile }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const total = route.distance_mi || 1;
  const stretches = useMemo(() => bands(route), [route]);
  const ticks = useMemo(() => {
    const step = hourStep(route.duration_h);
    const out: { h: number; mile: number }[] = [];
    for (let h = step; h < route.duration_h; h += step) {
      const mile = mileAtHour(route.checkpoints, h);
      // Keep clear of the "0" and total-distance labels at the ends.
      if (mile !== null && mile / total > 0.05 && mile / total < 0.85) out.push({ h, mile });
    }
    return out;
  }, [route, total]);

  const truckMile = mileAtHour(route.checkpoints, hour);
  const hovered = hoveredMile === null ? null : checkpointAtMile(route.checkpoints, hoveredMile);

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    onHoverMile(((e.clientX - rect.left) / rect.width) * total);
  };

  return (
    <div className="profile">
      <div className="profile-track" ref={ref} onPointerMove={onMove} onPointerLeave={() => onHoverMile(null)}>
        {stretches.map((b) => (
          <span
            key={b.from}
            className="profile-band"
            style={{ left: pct(b.from, total), width: pct(b.to - b.from, total), background: RISK_COLOR[b.level] }}
          />
        ))}
        {truckMile !== null && (
          <span className="profile-truck" style={{ left: pct(truckMile, total) }} title={`Truck at +${hour}h`} />
        )}
        {hoveredMile !== null && <span className="profile-cursor" style={{ left: pct(hoveredMile, total) }} />}
      </div>

      <div className="profile-axis">
        <span style={{ left: 0 }}>0</span>
        {ticks.map((t) => (
          <span key={t.h} style={{ left: pct(t.mile, total) }}>
            +{t.h}h
          </span>
        ))}
        <span style={{ right: 0, left: "auto" }}>{formatMiles(route.distance_mi)}</span>
      </div>

      <div className="profile-readout" aria-live="polite">
        {hovered ? (
          <>
            <b>Mile {Math.round(hovered.mile)}</b>
            <span>{formatEta(hovered.eta)}</span>
            <span>
              {hovered.wind_mph !== null
                ? `${Math.round(hovered.wind_mph)} mph · ${hovered.rain_in_hr!.toFixed(2)}″ rain · ${hovered.snow_in_hr!.toFixed(2)}″ snow`
                : "no forecast"}
            </span>
            <span className="readout-level" style={{ color: RISK_COLOR[hovered.level] }}>
              {RISK_LABEL[hovered.level]}
            </span>
          </>
        ) : (
          <span className="muted">Touch or hover the strip to inspect a stretch · ▼ marks the truck at +{hour}h</span>
        )}
      </div>
    </div>
  );
});
