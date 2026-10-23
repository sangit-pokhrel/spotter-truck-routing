import type { Heatmap, PlanRequest, TripPlan } from "../api/types";

/** The last trip is kept on the device so it's still there with no signal. */
export interface SavedTrip {
  plan: TripPlan;
  request: PlanRequest | null;
  heatmap: Heatmap | null;
  savedAt: number;
}

const KEY = "trip.saved.v1";
/** Older than this, a saved trip is more confusing than useful. */
export const MAX_SAVED_AGE_MS = 3 * 24 * 3600_000;

export function loadSavedTrip(now = Date.now()): SavedTrip | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedTrip;
    if (!saved?.plan?.routes?.length || now - saved.savedAt > MAX_SAVED_AGE_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveTrip(trip: SavedTrip): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(trip));
  } catch {
    // Storage full: try once more without the (large) heatmap so routes still survive offline.
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...trip, heatmap: null }));
    } catch {
      // storage unavailable; nothing else to do
    }
  }
}

export function clearSavedTrip(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
