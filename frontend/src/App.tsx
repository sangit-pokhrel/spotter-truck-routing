import { useCallback, useEffect, useMemo, useState } from "react";
import type { HeatMetric } from "./api/types";
import { CheckpointList } from "./components/CheckpointList";
import { ForecastBar } from "./components/ForecastBar";
import { MapView, type FocusedCheckpoint, type HeatOverlay } from "./components/MapView";
import { RouteCard } from "./components/RouteCard";
import { TripForm } from "./components/TripForm";
import { useHeatmap, useTripPlan } from "./hooks/useTripPlan";
import { formatEta } from "./lib/format";
import { routePath, truckPosition } from "./lib/geo";
import { renderFrames } from "./lib/heatmapImage";

export default function App() {
  const trip = useTripPlan();
  const plan = trip.data;
  const heat = useHeatmap(plan);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metric, setMetric] = useState<HeatMetric>("risk");
  const [hour, setHour] = useState(0);
  const [focused, setFocused] = useState<FocusedCheckpoint | null>(null);

  useEffect(() => {
    setSelectedId(plan?.recommended_route ?? null);
    setHour(0);
    setFocused(null);
  }, [plan]);

  // Frames are rendered once per (heatmap, metric) and reused while scrubbing.
  const frameCache = useMemo(() => new Map<HeatMetric, string[]>(), [heat.data]);
  const frames = useMemo(() => {
    if (!heat.data) return null;
    if (!frameCache.has(metric)) frameCache.set(metric, renderFrames(heat.data, metric));
    return frameCache.get(metric)!;
  }, [heat.data, metric, frameCache]);

  const overlay: HeatOverlay | null = useMemo(() => {
    if (!heat.data || !frames) return null;
    const { south, west, north, east } = heat.data.grid;
    return { url: frames[hour], bounds: [[south, west], [north, east]] };
  }, [heat.data, frames, hour]);

  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null;
  const path = useMemo(() => (selected ? routePath(selected) : null), [selected]);
  const truck = selected && path ? truckPosition(selected, path, hour) : null;

  const maxHour = heat.data?.hours ?? 48;
  const step = useCallback(() => setHour((h) => (h >= maxHour ? 0 : h + 1)), [maxHour]);
  const sortedRoutes = useMemo(() => (plan ? [...plan.routes].sort((a, b) => a.rank - b.rank) : []), [plan]);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <span className="brand-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>Weather-Aware Truck Routing</h1>
            <p>Pick the safest route for your load, departure and the weather on the way.</p>
          </div>
        </header>

        <TripForm loading={trip.loading} onSubmit={trip.plan} />

        {trip.error && (
          <div className="alert error" role="alert">
            {trip.error}
          </div>
        )}

        {plan && (
          <section className="results" aria-live="polite">
            <div className="recommendation">
              <span className="eyebrow">Recommendation</span>
              <p>{plan.recommendation_reason}</p>
              <small>
                Departing {formatEta(plan.departure)} · {plan.load_weight_lb.toLocaleString()} lb · checkpoint every{" "}
                {plan.interval_mi} mi
              </small>
            </div>

            <div className="route-list">
              {sortedRoutes.map((r) => (
                <RouteCard
                  key={r.id}
                  route={r}
                  recommended={r.id === plan.recommended_route}
                  selected={r.id === selectedId}
                  onSelect={() => setSelectedId(r.id)}
                />
              ))}
            </div>

            {selected && (
              <details className="checkpoints" open>
                <summary>
                  {selected.name} checkpoints <span>({selected.checkpoints.length})</span>
                </summary>
                <CheckpointList
                  checkpoints={selected.checkpoints}
                  onFocus={(cp) => setFocused({ cp, routeName: selected.name })}
                />
              </details>
            )}
          </section>
        )}

        <footer className="credits">
          Routing © OSRM · Weather © Open-Meteo · Geocoding © Photon/OSM
        </footer>
      </aside>

      <main className="map-area">
        <MapView
          plan={plan}
          selectedId={selectedId}
          onSelectRoute={setSelectedId}
          heat={overlay}
          truck={truck}
          focused={focused}
          onFocus={setFocused}
        />
        {trip.loading && (
          <div className="map-loading" role="status">
            <span className="spinner" aria-hidden /> Fetching routes and forecasts at every checkpoint…
          </div>
        )}
        {!plan && !trip.loading && (
          <div className="map-hint">Enter a trip to compare three routes by weather risk and travel time.</div>
        )}
        {plan && (
          <ForecastBar
            start={plan.departure}
            hours={maxHour}
            hour={hour}
            onHour={setHour}
            onStep={step}
            metric={metric}
            onMetric={setMetric}
            loading={heat.loading}
            error={heat.error}
            spacingMi={heat.data?.grid.spacing_mi ?? null}
          />
        )}
      </main>
    </div>
  );
}
