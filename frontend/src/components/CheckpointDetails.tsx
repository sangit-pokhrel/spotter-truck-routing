import type { Checkpoint } from "../api/types";
import { formatEta } from "../lib/format";
import { RiskBadge } from "./RiskBadge";

export function CheckpointDetails({ cp, routeName }: { cp: Checkpoint; routeName: string }) {
  return (
    <div className="cp-details">
      <div className="cp-details-head">
        <strong>
          {routeName} · mile {Math.round(cp.mile)}
        </strong>
        <RiskBadge level={cp.level} />
      </div>
      <div className="cp-details-eta">
        ETA {formatEta(cp.eta)}
        {cp.speed_limit_mph !== null && ` · limit ${cp.speed_limit_mph} mph`}
      </div>
      {cp.wind_mph !== null && (
        <dl>
          <dt>Wind</dt>
          <dd>
            {cp.wind_mph.toFixed(0)} mph{cp.gust_mph !== null && ` (gusts ${cp.gust_mph.toFixed(0)})`}
          </dd>
          <dt>Rain</dt>
          <dd>{cp.rain_in_hr!.toFixed(2)} in/hr</dd>
          <dt>Snow</dt>
          <dd>{cp.snow_in_hr!.toFixed(2)} in/hr</dd>
        </dl>
      )}
      {cp.factors.length > 0 && (
        <ul className="cp-factors">
          {cp.factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
