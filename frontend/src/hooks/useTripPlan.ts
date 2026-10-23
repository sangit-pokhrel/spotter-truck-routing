import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Heatmap, PlanRequest, TripPlan } from "../api/types";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Plans a trip; a new request aborts the one in flight so stale results never win. */
export function useTripPlan() {
  const [state, setState] = useState<AsyncState<TripPlan>>({ data: null, loading: false, error: null });
  const controller = useRef<AbortController | null>(null);

  const plan = useCallback(async (body: PlanRequest) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.plan(body, ctrl.signal);
      setState({ data, loading: false, error: null });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

  /** Show a previously saved plan without touching the network (offline / reopened app). */
  const restore = useCallback((data: TripPlan) => {
    controller.current?.abort();
    setState({ data, loading: false, error: null });
  }, []);

  useEffect(() => () => controller.current?.abort(), []);
  return { ...state, plan, restore };
}

/** Loads the corridor heatmap after a plan arrives (routes render first, heatmap streams in).
 *  `preset` supplies an already-known heatmap for that exact plan (restored from the device). */
export function useHeatmap(plan: TripPlan | null, preset: { plan: TripPlan; heatmap: Heatmap } | null = null) {
  const [state, setState] = useState<AsyncState<Heatmap>>({ data: null, loading: false, error: null });
  // The heatmap depends only on the corridor, departure and load, not on ETAs, so a plan that
  // was merely re-timed (posted speed limits) keeps the heatmap it already has.
  const key = plan
    ? `${plan.departure}|${plan.load_weight_lb}|${plan.corridor.length}|${plan.corridor[0]}|${plan.corridor[plan.corridor.length - 1]}`
    : "";

  useEffect(() => {
    if (!plan) return;
    if (preset && preset.plan === plan) {
      setState({ data: preset.heatmap, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ data: null, loading: true, error: null });
    api
      .heatmap(plan, ctrl.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ data: null, loading: false, error: err.message });
      });
    return () => ctrl.abort();
    // Keyed on what the heatmap depends on; `preset` only matters for the restored plan.
  }, [key]);

  return state;
}
