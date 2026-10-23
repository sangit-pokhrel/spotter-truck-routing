import type { RiskKey } from "../api/types";
import { RISK_LABEL } from "../lib/risk";

export function RiskBadge({ level }: { level: RiskKey }) {
  return <span className={`risk-badge risk-${level}`}>{RISK_LABEL[level]}</span>;
}
