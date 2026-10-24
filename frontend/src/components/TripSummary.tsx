import Button from "@mui/material/Button";
import type { TripPlan } from "../api/types";
import { formatEta } from "../lib/format";

const short = (label: string) => label.split(",")[0];

export function TripSummary({ plan, onEdit }: { plan: TripPlan; onEdit: () => void }) {
  return (
    <div className="trip-summary">
      <div className="trip-summary-text">
        <b>
          {short(plan.origin.label)} <span aria-label="to">→</span> {short(plan.destination.label)}
        </b>
        <span>
          {formatEta(plan.departure)} · {plan.load_weight_lb.toLocaleString()} lb · every {plan.interval_mi} mi
        </span>
      </div>
      <Button variant="outlined" onClick={onEdit} sx={{ flex: "none" }}>
        Edit trip
      </Button>
    </div>
  );
}
