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

  useEffect(() => () => controller.current?.abort(), []);
  return { ...state, plan };
}

/** Loads the corridor heatmap after a plan arrives (routes render first, heatmap streams in). */
export function useHeatmap(plan: TripPlan | null) {
  const [state, setState] = useState<AsyncState<Heatmap>>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!plan) return;
    const ctrl = new AbortController();
    setState({ data: null, loading: true, error: null });
    api
      .heatmap(plan, ctrl.signal)
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState({ data: null, loading: false, error: err.message });
      });
    return () => ctrl.abort();
  }, [plan]);

  return state;
}
