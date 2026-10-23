import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HeatMetric, PlanRequest, TripPlan } from "./api/types";
import { CheckpointList } from "./components/CheckpointList";
import { ForecastBar } from "./components/ForecastBar";
import { LiveBar } from "./components/LiveBar";
import { MapView, type FocusedCheckpoint, type HeatOverlay } from "./components/MapView";
import { RouteComparison } from "./components/RouteComparison";
import { RouteProfile } from "./components/RouteProfile";
import { TripForm } from "./components/TripForm";
import { TripSummary } from "./components/TripSummary";
import { COMPACT_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { useHeatmap, useTripPlan } from "./hooks/useTripPlan";
import { BASEMAPS, loadBasemap, saveBasemap, type BasemapId } from "./lib/basemaps";
import { pointAtMile, routePath, truckPosition } from "./lib/geo";
import { renderFrames } from "./lib/heatmapImage";
import { describeChange, type PlanChange } from "./lib/live";
import { getCurrentPlace } from "./lib/location";
import { ROUTE_COLORS } from "./lib/risk";

const LIVE_INTERVAL_MIN = 15;
/** When the app returns to the foreground, re-check if the last update is older than this. */
const LIVE_STALE_MS = 5 * 60_000;

export default function App() {
  const trip = useTripPlan();
  const plan = trip.data;
  const heat = useHeatmap(plan);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metric, setMetric] = useState<HeatMetric>("risk");
  const [hour, setHour] = useState(0);
  const [focused, setFocused] = useState<FocusedCheckpoint | null>(null);
  const [hoveredMile, setHoveredMile] = useState<number | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const [fitKey, setFitKey] = useState(0);
  const [editing, setEditing] = useState(true);
  const compact = useMediaQuery(COMPACT_QUERY);

  // --- Live mode: re-plan from the truck's position so the risk ahead reflects current forecasts.
  const [lastRequest, setLastRequest] = useState<PlanRequest | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [change, setChange] = useState<PlanChange | null>(null);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const recheckFrom = useRef<TripPlan | null>(null); // plan being re-checked; null for a manual plan

  const planTrip = useCallback(
    (body: PlanRequest) => {
      setLastRequest(body);
      setChange(null);
      setLiveNote(null);
      recheckFrom.current = null;
      trip.plan(body);
    },
    [trip.plan],
  );

  const recheck = useCallback(async () => {
    if (!lastRequest || !plan || trip.loading) return;
    let origin = lastRequest.origin;
    try {
      origin = await getCurrentPlace("Current location");
      setLiveNote(null);
    } catch {
      setLiveNote("GPS unavailable: refreshed forecasts from the original start instead.");
    }
    recheckFrom.current = plan;
    trip.plan({ ...lastRequest, origin, departure_time: new Date().toISOString() });
  }, [lastRequest, plan, trip.loading, trip.plan]);

  // Timers call the latest `recheck` without being reset every render.
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;
  const updatedRef = useRef(updatedAt);
  updatedRef.current = updatedAt;

  useEffect(() => {
    if (!live) return;
    recheckRef.current();
    const id = window.setInterval(() => recheckRef.current(), LIVE_INTERVAL_MIN * 60_000);
    // Phones pause timers in the background; catch up when the driver looks again.
    const onVisible = () => {
      const last = updatedRef.current?.getTime() ?? 0;
      if (document.visibilityState === "visible" && Date.now() - last > LIVE_STALE_MS) recheckRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Keep a mounted phone's screen on while live (best effort; unsupported browsers ignore it).
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [live]);

  useEffect(() => {
    setSelectedId(plan?.recommended_route ?? null);
    setHour(0);
    setFocused(null);
    setHoveredMile(null);
    if (!plan) return;
    setUpdatedAt(new Date());
    const previous = recheckFrom.current;
    recheckFrom.current = null;
    if (previous) {
      setChange(describeChange(previous, plan));
      return; // live refresh: don't collapse/scroll the driver's view
    }
    setEditing(false);
    // Phones: the map moves to the top once there are results; bring it into view.
    if (compact) window.scrollTo({ top: 0, behavior: "smooth" });
    // Only react to a new plan (not to viewport changes).
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
  const hoverPoint = selected && path && hoveredMile !== null ? pointAtMile(selected, path, hoveredMile) : null;

  const maxHour = heat.data?.hours ?? 48;
  const step = useCallback(() => setHour((h) => (h >= maxHour ? 0 : h + 1)), [maxHour]);

  const chooseBasemap = (id: BasemapId) => {
    setBasemap(id);
    saveBasemap(id);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <h1>Weather-Aware Truck Routing</h1>
        <span className="topbar-sub">Route risk from forecast weather at your ETA</span>
        <nav className="topbar-meta">
          <span>OSRM</span>
          <span>Open-Meteo</span>
          <span>Photon</span>
        </nav>
      </header>

      <div className={`workspace${plan ? " has-plan" : ""}`}>
        <aside className="panel">
          <section className="section s-trip">
            {plan && !editing && (
              <>
                <TripSummary plan={plan} onEdit={() => setEditing(true)} />
                <LiveBar
                  live={live}
                  onToggle={setLive}
                  onRecheck={recheck}
                  busy={trip.loading}
                  updatedAt={updatedAt}
                  intervalMin={LIVE_INTERVAL_MIN}
                  change={change}
                  note={liveNote}
                />
              </>
            )}
            {/* Kept mounted while collapsed so the inputs survive "Edit trip". */}
            <div hidden={!!plan && !editing}>
              <h2 className="section-title">
                Trip
                {plan && (
                  <button type="button" className="link-btn" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                )}
              </h2>
              <TripForm loading={trip.loading} onSubmit={planTrip} />
            </div>
            {trip.error && (
              <p className="alert" role="alert">
                {trip.error}
              </p>
            )}
          </section>

          {plan && (
            <>
              <section className="section s-verdict" aria-live="polite">
                <div className="verdict" style={{ borderColor: ROUTE_COLORS[plan.recommended_route] }}>
                  <div className="verdict-head">
                    <span>Recommended</span>
                    <b>Route {plan.recommended_route}</b>
                  </div>
                  <p>{plan.recommendation_reason}</p>
                </div>
              </section>

              <section className="section s-compare">
                <h2 className="section-title">
                  Compare routes <span className="muted">tap a route to inspect</span>
                </h2>
                <RouteComparison
                  routes={plan.routes}
                  recommendedId={plan.recommended_route}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </section>

              {selected && (
                <section className="section section-fill s-checkpoints">
                  {/* Collapsed by default on phones to keep the page short. */}
                  <details open={!compact} key={String(compact)}>
                    <summary className="section-title">
                      Route {selected.id} checkpoints <span className="muted">{selected.checkpoints.length}</span>
                    </summary>
                    <CheckpointList
                      checkpoints={selected.checkpoints}
                      onFocus={(cp) => setFocused({ cp, routeName: selected.name })}
                      onHover={setHoveredMile}
                    />
                  </details>
                </section>
              )}
            </>
          )}

          {!plan && !trip.loading && (
            <section className="section intro s-intro">
              <h2 className="section-title">How it works</h2>
              <ol>
                <li>Three route options are generated between your origin and destination.</li>
                <li>Every 10, 25 or 50 miles, the forecast is checked for the hour your truck arrives there.</li>
                <li>Wind, rain, snow and your load weight set each stretch's risk level.</li>
                <li>Routes are ranked: fewest Severe miles, then High miles, average risk, and travel time.</li>
              </ol>
            </section>
          )}
        </aside>

        <main className="stage">
          <div className="map-wrap">
            <MapView
              plan={plan}
              selectedId={selectedId}
              onSelectRoute={setSelectedId}
              heat={overlay}
              truck={truck}
              hoverPoint={hoverPoint}
              focused={focused}
              onFocus={setFocused}
              basemap={basemap}
              fitKey={fitKey}
            />
            <div className="map-toolbar">
              <div className="seg seg-sm seg-map" role="radiogroup" aria-label="Base map">
                {Object.values(BASEMAPS).map((b) => (
                  <label key={b.id} className={basemap === b.id ? "on" : undefined}>
                    <input type="radio" name="basemap" checked={basemap === b.id} onChange={() => chooseBasemap(b.id)} />
                    {b.label}
                  </label>
                ))}
              </div>
              {plan && (
                <button type="button" className="map-btn" onClick={() => setFitKey((k) => k + 1)}>
                  Fit routes
                </button>
              )}
            </div>
            {trip.loading && (
              <div className="map-status" role="status">
                <span className="progress" aria-hidden />
                Routing and checking forecasts at every checkpoint…
              </div>
            )}
            {!plan && !trip.loading && <div className="map-empty">Plan a trip to compare routes by weather risk</div>}
          </div>

          {plan && selected && (
            <section className="dock" aria-label="Weather along the route and forecast heatmap">
              <div className="dock-row">
                <div className="dock-label">
                  <span className="swatch" style={{ background: ROUTE_COLORS[selected.id] }} aria-hidden />
                  Route {selected.id} at ETA
                </div>
                <RouteProfile route={selected} hour={hour} hoveredMile={hoveredMile} onHoverMile={setHoveredMile} />
              </div>
              <div className="dock-row">
                <div className="dock-label">Corridor heatmap</div>
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
                />
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
