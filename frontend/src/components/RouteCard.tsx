import type { RouteOption } from "../api/types";
import { formatClock, formatDuration, formatMiles } from "../lib/format";
import { ROUTE_COLORS } from "../lib/risk";
import { RiskBadge } from "./RiskBadge";

interface Props {
  route: RouteOption;
  recommended: boolean;
  onClose: () => void;
}

export function RouteCard({ route, recommended, onClose }: Props) {
  const m = route.miles_by_level;
  const severe = m.severe + m.no_travel;
  return (
    <div className="route-card" role="dialog" aria-label={`Route ${route.id} summary`}>
      <span className="route-card-badge" style={{ background: ROUTE_COLORS[route.id] }}>
        {route.id}
      </span>
      <div className="route-card-body">
        <div className="route-card-head">
          <b>Route {route.id}</b>
          {recommended && <span className="pick">Best</span>}
          <RiskBadge level={route.max_level} />
        </div>
        <div className="route-card-stats">
          <span>{formatDuration(route.duration_h)}</span>
          <span>{formatMiles(route.distance_mi)}</span>
          <span className={severe > 0 ? "rl-bad" : undefined}>{formatMiles(severe)} severe</span>
          <span>{formatMiles(m.high)} high</span>
          <span>arr. {formatClock(route.arrival)}</span>
        </div>
      </div>
      <button type="button" className="route-card-close" onClick={onClose} aria-label="Close route summary">
        ×
      </button>
    </div>
  );
}
