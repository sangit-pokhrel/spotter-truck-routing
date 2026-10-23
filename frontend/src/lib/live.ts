import type { Checkpoint, RouteOption, TripPlan } from "../api/types";
import { mileAtHour } from "./geo";
import { RISK_LABEL, RISK_ORDER } from "./risk";

/** Road mile the truck should be at `now`, from the plan's departure and checkpoint ETAs. */
export function milesDriven(plan: TripPlan, route: RouteOption, now = Date.now()): number {
  const hours = (now - Date.parse(plan.departure)) / 3600_000;
  if (hours <= 0) return 0;
  return mileAtHour(route.checkpoints, hours) ?? route.distance_mi;
}

export interface Hazard {
  checkpoint: Checkpoint;
  milesAway: number;
}

/** First checkpoint at or beyond `fromMile` rated Moderate or worse; null when the rest is Low. */
export function nextHazard(route: RouteOption, fromMile: number): Hazard | null {
  for (const cp of route.checkpoints) {
    if (cp.mile + 0.5 < fromMile) continue;
    if (RISK_ORDER.indexOf(cp.level) >= RISK_ORDER.indexOf("moderate")) {
      return { checkpoint: cp, milesAway: Math.max(0, cp.mile - fromMile) };
    }
  }
  return null;
}

export type ChangeTone = "worse" | "better" | "same";

export interface PlanChange {
  tone: ChangeTone;
  text: string;
}

const severity = (r: RouteOption) => RISK_ORDER.indexOf(r.max_level); // unknown → -1
const severeMiles = (r: RouteOption) => r.miles_by_level.severe + r.miles_by_level.no_travel;
const best = (p: TripPlan) => p.routes.find((r) => r.id === p.recommended_route)!;

/** Small differences (a few miles) are just re-sampling noise, not a change worth an alert. */
const MILES_NOISE = 5;

/** What changed for the driver between two plans of the same trip (re-checked from a new position). */
export function describeChange(prev: TripPlan, next: TripPlan): PlanChange {
  const a = best(prev);
  const b = best(next);

  if (severity(b) > severity(a)) {
    return { tone: "worse", text: `Weather ahead got worse: now up to ${RISK_LABEL[b.max_level]} on Route ${b.id}.` };
  }
  if (severeMiles(b) > severeMiles(a) + MILES_NOISE) {
    return { tone: "worse", text: `${Math.round(severeMiles(b))} Severe miles ahead now (was ${Math.round(severeMiles(a))}).` };
  }
  if (b.miles_by_level.high > a.miles_by_level.high + MILES_NOISE) {
    return { tone: "worse", text: `${Math.round(b.miles_by_level.high)} High-risk miles ahead now (was ${Math.round(a.miles_by_level.high)}).` };
  }
  if (severity(b) < severity(a) || severeMiles(b) + MILES_NOISE < severeMiles(a)) {
    return { tone: "better", text: `Conditions ahead improved: worst is now ${RISK_LABEL[b.max_level]}.` };
  }
  return { tone: "same", text: "No change in risk ahead." };
}
