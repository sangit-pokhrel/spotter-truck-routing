import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanRequest, TripPlan } from "../api/types";
import { describeChange, type PlanChange } from "../lib/live";
import { getCurrentPlace } from "../lib/location";
import { notificationsSupported, notify, requestNotifications } from "../lib/notify";
import { loadPref, savePref } from "../lib/prefs";
import { loadSavedTrip, saveTrip } from "../lib/savedTrip";
import { useOnline } from "./useOnline";
import { useHeatmap, useTripPlan } from "./useTripPlan";

export const LIVE_INTERVAL_MIN = 15;
/** When the app returns to the foreground, re-check if the last update is older than this. */
const LIVE_STALE_MS = 5 * 60_000;

/** Re-plan delay while the server is still fetching speed limits. */
const REFINE_DELAY_MS = 12_000;
const MAX_REFINES = 4;

/** Where the current plan came from. */
export type PlanKind = "manual" | "recheck" | "refine" | "restored";

/** Trip state outside the layout: planning, live re-checks, alerts, the offline copy, connectivity. */
export function useTripSession(onNewPlan: (plan: TripPlan, kind: PlanKind) => void) {
  const trip = useTripPlan();
  const plan = trip.data;
  const online = useOnline();

  // last trip saved on the device, read once
  const [saved] = useState(loadSavedTrip);
  const restored = useRef(saved?.plan ?? null);
  const heatPreset = useMemo(() => (saved?.heatmap ? { plan: saved.plan, heatmap: saved.heatmap } : null), [saved]);
  const heat = useHeatmap(plan, heatPreset);

  const [lastRequest, setLastRequest] = useState<PlanRequest | null>(saved?.request ?? null);
  const [live, setLive] = useState(false);
  const [alerts, setAlertsState] = useState(() => notificationsSupported() && loadPref("alerts", "0") === "1");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [change, setChange] = useState<PlanChange | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const recheckFrom = useRef<TripPlan | null>(null); // plan being re-checked; null for a manual plan
  const currentRequest = useRef<PlanRequest | null>(saved?.request ?? null); // exact body behind `plan`
  const refining = useRef(false);
  const refines = useRef(0);
  const refineTimer = useRef<number | undefined>(undefined);

  /** All requests go through here so a refine repeats the exact same trip. */
  const runPlan = useCallback(
    (body: PlanRequest) => {
      window.clearTimeout(refineTimer.current);
      currentRequest.current = body;
      trip.plan(body);
    },
    [trip.plan],
  );

  useEffect(() => {
    if (saved) trip.restore(saved.plan);
    // run once: restore the saved trip on startup
  }, []);

  const planTrip = useCallback(
    (body: PlanRequest) => {
      setLastRequest(body);
      setChange(null);
      setLiveNote(null);
      recheckFrom.current = null;
      refines.current = 0;
      runPlan(body);
    },
    [runPlan],
  );

  const recheck = useCallback(async () => {
    if (!lastRequest || !plan || trip.loading || !navigator.onLine) return;
    let origin = lastRequest.origin;
    try {
      origin = await getCurrentPlace("Current location");
      setLiveNote(null);
    } catch {
      setLiveNote("GPS unavailable: refreshed forecasts from the original start instead.");
    }
    recheckFrom.current = plan;
    refines.current = 0;
    runPlan({ ...lastRequest, origin, departure_time: new Date().toISOString() });
  }, [lastRequest, plan, trip.loading, runPlan]);

  const setAlerts = useCallback(async (on: boolean) => {
    const granted = on ? await requestNotifications() : false;
    setAlertsState(granted);
    savePref("alerts", granted ? "1" : "0");
    if (on && !granted) setLiveNote("Notifications are blocked. Allow them in your browser settings to get alerts.");
  }, []);

  // classify each new plan, compare it with the previous one, alert if worse
  useEffect(() => {
    if (!plan) return;
    let kind: PlanKind = "manual";
    if (plan === restored.current) {
      kind = "restored";
      setUpdatedAt(saved ? new Date(saved.savedAt) : null);
    } else if (refining.current) {
      kind = "refine";
      refining.current = false;
      if (plan.speed_limits === "applied") setLiveNote("ETAs refined with posted speed limits.");
    } else {
      restored.current = null;
      setUpdatedAt(new Date());
      const previous = recheckFrom.current;
      recheckFrom.current = null;
      if (previous) {
        kind = "recheck";
        const diff = describeChange(previous, plan);
        setChange(diff);
        if (diff.tone === "worse" && alerts) notify("Weather ahead got worse", diff.text);
      }
    }
    onNewPlan(plan, kind);

    // Limits still loading: re-plan shortly (routes and weather are cached by then).
    // shortly (routes and weather are cached by then) to get the refined ETAs.
    if (
      plan.speed_limits === "pending" &&
      kind !== "restored" &&
      refines.current < MAX_REFINES &&
      currentRequest.current
    ) {
      const body = currentRequest.current;
      refineTimer.current = window.setTimeout(() => {
        if (!navigator.onLine) return;
        refines.current += 1;
        refining.current = true;
        runPlan(body);
      }, REFINE_DELAY_MS);
    }
    // Only react to a new plan.
  }, [plan]);

  useEffect(() => () => window.clearTimeout(refineTimer.current), []);

  // keep the latest plan and heatmap for offline use
  useEffect(() => {
    if (!plan || plan === restored.current) return;
    saveTrip({ plan, request: lastRequest, heatmap: heat.data, savedAt: Date.now() });
  }, [plan, heat.data]);

  // timers call the latest `recheck` without being reset each render
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;
  const updatedRef = useRef(updatedAt);
  updatedRef.current = updatedAt;

  useEffect(() => {
    if (!live) return;
    recheckRef.current();
    const id = window.setInterval(() => recheckRef.current(), LIVE_INTERVAL_MIN * 60_000);
    // phones pause timers in the background; catch up on return or reconnect
    const catchUp = () => {
      const last = updatedRef.current?.getTime() ?? 0;
      if (document.visibilityState === "visible" && Date.now() - last > LIVE_STALE_MS) recheckRef.current();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", catchUp);
    // keep a mounted phone's screen on (best effort)
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", catchUp);
      lock?.release().catch(() => {});
    };
  }, [live]);

  return {
    plan,
    heat,
    loading: trip.loading,
    error: trip.error,
    online,
    planTrip,
    recheck,
    live,
    setLive,
    alerts: notificationsSupported() ? alerts : null,
    setAlerts,
    updatedAt,
    change,
    liveNote,
    /** Set while the plan on screen was reopened from the device rather than freshly planned. */
    showingSaved: plan !== null && plan === restored.current,
  };
}
