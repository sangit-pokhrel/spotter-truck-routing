import type { RiskKey, RouteOption } from "../api/types";
import { formatClock, formatDuration, formatMiles } from "../lib/format";
import { RISK_COLOR, RISK_LABEL, RISK_ORDER, ROUTE_COLORS } from "../lib/risk";

interface Props {
  routes: RouteOption[];
  recommendedId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface Row {
  label: string;
  /** Position in the recommendation order (1 = decided first); undefined for info rows. */
  priority?: number;
  value: (r: RouteOption) => number;
  format: (r: RouteOption) => string;
}

// Same order the backend ranks by (see backend/trips/services/recommendation.py).
const ROWS: Row[] = [
  { label: "No Travel", priority: 1, value: (r) => r.miles_by_level.no_travel, format: (r) => formatMiles(r.miles_by_level.no_travel) },
  { label: "Severe", priority: 2, value: (r) => r.miles_by_level.severe, format: (r) => formatMiles(r.miles_by_level.severe) },
  { label: "High", priority: 3, value: (r) => r.miles_by_level.high, format: (r) => formatMiles(r.miles_by_level.high) },
  { label: "Avg risk", priority: 4, value: (r) => r.avg_risk, format: (r) => r.avg_risk.toFixed(2) },
  { label: "Drive time", priority: 5, value: (r) => r.duration_h, format: (r) => formatDuration(r.duration_h) },
  { label: "Distance", value: (r) => r.distance_mi, format: (r) => formatMiles(r.distance_mi) },
  { label: "Arrives", value: (r) => Date.parse(r.arrival), format: (r) => formatClock(r.arrival) },
];

const MIX_LEVELS: RiskKey[] = [...RISK_ORDER, "unknown"];

export function RouteComparison({ routes, recommendedId, selectedId, onSelect }: Props) {
  const cellClass = (r: RouteOption, extra = "") =>
    `${r.id === selectedId ? "is-selected" : ""} ${extra}`.trim() || undefined;

  return (
    <div className="compare-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th scope="col" className="compare-corner">
              <span className="muted">Ranked by</span>
            </th>
            {routes.map((r) => (
              <th key={r.id} scope="col" className={cellClass(r)}>
                <button type="button" className="compare-head" onClick={() => onSelect(r.id)} aria-pressed={r.id === selectedId}>
                  <span className="compare-name">
                    <span className="swatch" style={{ background: ROUTE_COLORS[r.id] }} aria-hidden />
                    Route {r.id}
                  </span>
                  {r.id === recommendedId ? <span className="pick">Best</span> : <span className="rank">rank {r.rank}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const values = routes.map(row.value);
            const best = Math.min(...values);
            const decisive = values.some((v) => v !== best);
            return (
              <tr key={row.label} className={row.priority ? undefined : "info-row"}>
                <th scope="row">
                  {row.priority && <span className="prio">{row.priority}</span>}
                  {row.label}
                </th>
                {routes.map((r, i) => (
                  <td
                    key={r.id}
                    className={cellClass(r, decisive && values[i] === best ? "is-best" : "")}
                    onClick={() => onSelect(r.id)}
                  >
                    {row.format(r)}
                  </td>
                ))}
              </tr>
            );
          })}
          <tr className="mix-row">
            <th scope="row">Risk mix</th>
            {routes.map((r) => (
              <td key={r.id} className={cellClass(r)} onClick={() => onSelect(r.id)}>
                <div className="mix" role="img" aria-label={mixLabel(r)}>
                  {MIX_LEVELS.filter((k) => r.miles_by_level[k] > 0).map((k) => (
                    <span key={k} style={{ flexGrow: r.miles_by_level[k], background: RISK_COLOR[k] }} />
                  ))}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function mixLabel(r: RouteOption): string {
  return MIX_LEVELS.filter((k) => r.miles_by_level[k] > 0)
    .map((k) => `${RISK_LABEL[k]} ${formatMiles(r.miles_by_level[k])}`)
    .join(", ");
}
