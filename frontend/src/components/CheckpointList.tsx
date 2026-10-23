import { memo } from "react";
import type { Checkpoint } from "../api/types";
import { formatEta } from "../lib/format";
import { RiskBadge } from "./RiskBadge";

interface Props {
  checkpoints: Checkpoint[];
  onFocus: (cp: Checkpoint) => void;
  onHover: (mile: number | null) => void;
}

function num(v: number | null, digits: number): string {
  return v === null ? "–" : v.toFixed(digits);
}

/** The limit a truck must obey: the posted limit, or a lower state truck limit (marked). */
function TruckLimit({ cp }: { cp: Checkpoint }) {
  const truck = cp.truck_limit_mph;
  if (truck !== null && (cp.speed_limit_mph === null || truck < cp.speed_limit_mph)) {
    return (
      <span className="truck-limit" title={`State truck limit${cp.speed_limit_mph ? ` (posted ${cp.speed_limit_mph})` : ""}`}>
        {truck} <small>truck</small>
      </span>
    );
  }
  return <>{num(cp.speed_limit_mph, 0)}</>;
}

export const CheckpointList = memo(function CheckpointList({ checkpoints, onFocus, onHover }: Props) {
  return (
    <div className="cp-wrap" onMouseLeave={() => onHover(null)}>
      <table className="cp-table">
        <thead>
          <tr>
            <th scope="col">Mile</th>
            <th scope="col">ETA</th>
            <th scope="col" className="num" title="Speed limit for trucks, mph (posted, or a lower state truck limit)">
              Limit
            </th>
            <th scope="col" className="num" title="Sustained wind, mph">
              Wind
            </th>
            <th scope="col" className="num" title="Rain, in/hr">
              Rain
            </th>
            <th scope="col" className="num" title="Snow, in/hr">
              Snow
            </th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((cp) => (
            <tr
              key={cp.mile}
              tabIndex={0}
              onClick={() => onFocus(cp)}
              onKeyDown={(e) => e.key === "Enter" && onFocus(cp)}
              onMouseEnter={() => onHover(cp.mile)}
              title={cp.factors.join("\n") || "No risk factors"}
            >
              <td className="num">{Math.round(cp.mile)}</td>
              <td>{formatEta(cp.eta)}</td>
              <td className="num">
                <TruckLimit cp={cp} />
              </td>
              <td className="num">{num(cp.wind_mph, 0)}</td>
              <td className="num">{num(cp.rain_in_hr, 2)}</td>
              <td className="num">{num(cp.snow_in_hr, 2)}</td>
              <td>
                <RiskBadge level={cp.level} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
