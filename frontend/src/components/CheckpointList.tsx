import { memo } from "react";
import type { Checkpoint } from "../api/types";
import { formatEta } from "../lib/format";
import { RiskBadge } from "./RiskBadge";

interface Props {
  checkpoints: Checkpoint[];
  onFocus: (cp: Checkpoint) => void;
}

function weatherText(cp: Checkpoint): string {
  if (cp.wind_mph === null) return "—";
  const parts = [`${Math.round(cp.wind_mph)} mph`];
  if ((cp.rain_in_hr ?? 0) > 0) parts.push(`${cp.rain_in_hr!.toFixed(2)}″ rain`);
  if ((cp.snow_in_hr ?? 0) > 0) parts.push(`${cp.snow_in_hr!.toFixed(2)}″ snow`);
  return parts.join(" · ");
}

export const CheckpointList = memo(function CheckpointList({ checkpoints, onFocus }: Props) {
  return (
    <div className="checkpoint-table-wrap">
      <table className="checkpoint-table">
        <thead>
          <tr>
            <th scope="col">Mile</th>
            <th scope="col">ETA</th>
            <th scope="col">Weather</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>
          {checkpoints.map((cp) => (
            <tr key={cp.mile} onClick={() => onFocus(cp)} title={cp.factors.join("\n") || "No risk factors"}>
              <td>{Math.round(cp.mile)}</td>
              <td>{formatEta(cp.eta)}</td>
              <td>{weatherText(cp)}</td>
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
