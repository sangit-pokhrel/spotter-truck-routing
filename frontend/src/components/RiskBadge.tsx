import type { RiskKey } from "../api/types";
import { RISK_COLOR, RISK_LABEL } from "../lib/risk";

export function RiskBadge({ level }: { level: RiskKey }) {
  return (
    <span className="risk-tag">
      <i style={{ background: RISK_COLOR[level] }} aria-hidden />
      {RISK_LABEL[level]}
    </span>
  );
}
