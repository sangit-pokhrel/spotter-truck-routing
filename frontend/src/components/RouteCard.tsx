import type { RiskKey, RouteOption } from "../api/types";
import { formatDuration, formatEta, formatMiles } from "../lib/format";
import { RISK_COLOR, RISK_LABEL, RISK_ORDER } from "../lib/risk";
import { RiskBadge } from "./RiskBadge";

interface Props {
  route: RouteOption;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}

const BAR_LEVELS: RiskKey[] = [...RISK_ORDER, "unknown"];

export function RouteCard({ route, recommended, selected, onSelect }: Props) {
  const m = route.miles_by_level;
  return (
    <button
      type="button"
      className={`route-card${selected ? " selected" : ""}${recommended ? " recommended" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="route-card-head">
        <span className={`route-dot route-${route.id}`} aria-hidden />
        <strong>{route.name}</strong>
        <span className="rank">#{route.rank}</span>
        {recommended && <span className="recommended-tag">Recommended</span>}
      </div>

      <dl className="route-stats">
        <div>
          <dt>Distance</dt>
          <dd>{formatMiles(route.distance_mi)}</dd>
        </div>
        <div>
          <dt>Drive time</dt>
          <dd>{formatDuration(route.duration_h)}</dd>
        </div>
        <div>
          <dt>Arrive</dt>
          <dd>{formatEta(route.arrival)}</dd>
        </div>
        <div>
          <dt>Worst</dt>
          <dd>
            <RiskBadge level={route.max_level} />
          </dd>
        </div>
      </dl>

      <div className="risk-bar" role="img" aria-label={riskBarLabel(route)}>
        {BAR_LEVELS.filter((k) => m[k] > 0).map((k) => (
          <span
            key={k}
            style={{ flexGrow: m[k], background: RISK_COLOR[k] }}
            title={`${RISK_LABEL[k]}: ${formatMiles(m[k])}`}
          />
        ))}
      </div>
      <div className="risk-miles">
        <span>Severe+ {formatMiles(m.severe + m.no_travel)}</span>
        <span>High {formatMiles(m.high)}</span>
        <span>Avg risk {route.avg_risk.toFixed(2)}</span>
      </div>
    </button>
  );
}

function riskBarLabel(route: RouteOption): string {
  return BAR_LEVELS.filter((k) => route.miles_by_level[k] > 0)
    .map((k) => `${RISK_LABEL[k]} ${formatMiles(route.miles_by_level[k])}`)
    .join(", ");
}
