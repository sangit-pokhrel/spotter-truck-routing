import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Checkpoint, HeatMetric, TripPlan } from "./api/types";
import { CheckpointList } from "./components/CheckpointList";
import { ForecastBar } from "./components/ForecastBar";
import { FitIcon, PipIcon } from "./components/icons";
import { LiveBar } from "./components/LiveBar";
import { MapView, type FocusedCheckpoint, type HeatOverlay } from "./components/MapView";
import { RouteComparison } from "./components/RouteComparison";
import { RouteProfile } from "./components/RouteProfile";
import { TripForm } from "./components/TripForm";
import { RouteCard } from "./components/RouteCard";
import { TripSummary } from "./components/TripSummary";
import { COMPACT_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { LIVE_INTERVAL_MIN, useTripSession, type PlanKind } from "./hooks/useTripSession";
import { BASEMAPS, loadBasemap, saveBasemap, type BasemapId } from "./lib/basemaps";
import { FloatingView, floatingSupported } from "./lib/floating";
import { formatEta } from "./lib/format";
import { pointAtMile, routePath, truckPosition } from "./lib/geo";
import { renderFrames } from "./lib/heatmapImage";
import { canInstall, onInstallAvailabilityChange, promptInstall } from "./lib/pwa";
import { ROUTE_COLORS } from "./lib/risk";

// map controls float over tiles, so they need their own background and shadow
const MAP_CONTROL: SxProps<Theme> = { bgcolor: "background.paper", boxShadow: 1, borderColor: "divider" };

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metric, setMetric] = useState<HeatMetric>("risk");
  const [hour, setHour] = useState(0);
  const [focused, setFocused] = useState<FocusedCheckpoint | null>(null);
  const [hoveredMile, setHoveredMile] = useState<number | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>(loadBasemap);
  const [fitKey, setFitKey] = useState(0);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null); // tapped A/B/C badge
  const [editing, setEditing] = useState(true);
  const compact = useMediaQuery(COMPACT_QUERY);

  const onNewPlan = useCallback(
    (plan: TripPlan, kind: PlanKind) => {
      setSelectedId(plan.recommended_route);
      setHour(0);
      setFocused(null);
      setExpandedRoute(null);
      setHoveredMile(null);
      if (kind === "recheck" || kind === "refine") return; // background refresh: leave the view alone
      setEditing(false);
      // on phones the map sits at the top once there are results
      if (kind === "manual" && compact) window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [compact],
  );
  const session = useTripSession(onNewPlan);
  const { plan, heat } = session;

  // frames are rendered once per layer and reused while scrubbing
  const frameCache = useMemo(() => new Map<HeatMetric, string[]>(), [heat.data]);
  const frames = useMemo(() => {
    if (!heat.data) return null;
    if (!frameCache.has(metric)) frameCache.set(metric, renderFrames(heat.data, metric));
    return frameCache.get(metric)!;
  }, [heat.data, metric, frameCache]);

  const overlay: HeatOverlay | null = useMemo(() => {
    if (!heat.data || !frames) return null;
    const { south, west, north, east } = heat.data.grid;
    return {
      url: frames[hour],
      bounds: [
        [south, west],
        [north, east],
      ],
    };
  }, [heat.data, frames, hour]);

  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null;
  const selectedName = selected?.name;
  // stable so the memoised checkpoint table doesn't re-render on every hover frame
  const focusCheckpoint = useCallback(
    (cp: Checkpoint) => selectedName && setFocused({ cp, routeName: selectedName }),
    [selectedName],
  );
  const path = useMemo(() => (selected ? routePath(selected) : null), [selected]);
  const truck = selected && path ? truckPosition(selected, path, hour) : null;
  const hoverPoint = selected && path && hoveredMile !== null ? pointAtMile(selected, path, hoveredMile) : null;

  const maxHour = heat.data?.hours ?? 48;
  const step = useCallback(() => setHour((h) => (h >= maxHour ? 0 : h + 1)), [maxHour]);

  const chooseBasemap = (id: BasemapId) => {
    setBasemap(id);
    saveBasemap(id);
  };

  // picture-in-picture mini map
  const floating = useRef<FloatingView | null>(null);
  const [floatingOpen, setFloatingOpen] = useState(false);
  const toggleFloating = async () => {
    if (floating.current) {
      await floating.current.close();
      return;
    }
    if (!plan || !selected) return;
    const view = new FloatingView();
    view.onClose = () => {
      floating.current = null;
      setFloatingOpen(false);
    };
    floating.current = view;
    setFloatingOpen(true);
    try {
      await view.open({ plan, route: selected, basemap });
    } catch {
      await view.close();
    }
  };
  useEffect(() => {
    if (floating.current && plan && selected) floating.current.update({ plan, route: selected, basemap });
  }, [plan, selected, basemap]);
  useEffect(() => () => void floating.current?.close(), []);

  // offered when the browser supports installing
  const [installable, setInstallable] = useState(canInstall);
  useEffect(() => onInstallAvailabilityChange(() => setInstallable(canInstall())), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <h1>Weather based Route Planning</h1>
        <span className="topbar-sub">Route risk from forecast weather at your ETA</span>
        <nav className="topbar-meta">
          {installable && (
            <Button size="small" variant="contained" onClick={promptInstall}>
              Install app
            </Button>
          )}
          <span className="meta-sources">OSRM · Open-Meteo · Photon</span>
        </nav>
      </header>

      {!session.online && (
        <Alert severity="warning" square role="status" className="app-banner">
          <b>Offline.</b>{" "}
          {plan
            ? `Showing your saved trip${session.updatedAt ? ` from ${formatEta(session.updatedAt.toISOString())}` : ""}. Live updates resume when you're back online.`
            : "Planning needs a connection. Your last trip will appear here once you've planned one."}
        </Alert>
      )}
      {session.online && session.showingSaved && (
        <Alert
          severity="info"
          square
          role="status"
          className="app-banner"
          action={
            <Button size="small" onClick={session.recheck} disabled={session.loading}>
              Refresh forecasts
            </Button>
          }
        >
          Showing your last trip, saved {session.updatedAt ? formatEta(session.updatedAt.toISOString()) : "earlier"}.
        </Alert>
      )}

      <div className={`workspace${plan ? " has-plan" : ""}`}>
        <aside className="panel">
          <section className="section s-trip">
            {plan && !editing && (
              <>
                <TripSummary plan={plan} onEdit={() => setEditing(true)} />
                <LiveBar
                  live={session.live}
                  onToggle={session.setLive}
                  onRecheck={session.recheck}
                  busy={session.loading}
                  offline={!session.online}
                  updatedAt={session.updatedAt}
                  intervalMin={LIVE_INTERVAL_MIN}
                  change={session.change}
                  note={session.liveNote}
                  alerts={session.alerts}
                  onAlerts={session.setAlerts}
                />
              </>
            )}
            {/* Kept mounted while collapsed so the inputs survive "Edit trip". */}
            <div hidden={!!plan && !editing}>
              <h2 className="section-title">
                Trip
                {plan && (
                  <Button size="small" onClick={() => setEditing(false)} sx={{ ml: "auto", py: 0 }}>
                    Cancel
                  </Button>
                )}
              </h2>
              <TripForm loading={session.loading} onSubmit={session.planTrip} />
            </div>
            {session.error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {session.error}
              </Alert>
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
                  <details open={!compact} key={String(compact)}>
                    <summary className="section-title">
                      Route {selected.id} checkpoints <span className="muted">{selected.checkpoints.length}</span>
                    </summary>
                    <CheckpointList
                      checkpoints={selected.checkpoints}
                      onFocus={focusCheckpoint}
                      onHover={setHoveredMile}
                    />
                  </details>
                </section>
              )}
            </>
          )}

          {!plan && !session.loading && (
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
              expandedId={expandedRoute}
              onExpand={setExpandedRoute}
              inlineDetails={!compact}
            />
            <div className="map-toolbar">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={basemap}
                onChange={(_, id: BasemapId | null) => id && chooseBasemap(id)}
                aria-label="Base map"
                sx={MAP_CONTROL}
              >
                {Object.values(BASEMAPS).map((b) => (
                  <ToggleButton key={b.id} value={b.id}>
                    {b.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              {plan && (
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  startIcon={<FitIcon />}
                  onClick={() => setFitKey((k) => k + 1)}
                  sx={MAP_CONTROL}
                >
                  Fit routes
                </Button>
              )}
              {plan && floatingSupported() && (
                <Tooltip title="Float a mini map over other apps">
                  <Button
                    size="small"
                    variant={floatingOpen ? "contained" : "outlined"}
                    color={floatingOpen ? "primary" : "inherit"}
                    startIcon={<PipIcon />}
                    onClick={toggleFloating}
                    aria-pressed={floatingOpen}
                    sx={MAP_CONTROL}
                  >
                    {floatingOpen ? "Close pop-out" : "Pop-out map"}
                  </Button>
                </Tooltip>
              )}
            </div>
            {compact && plan && expandedRoute && (
              <RouteCard
                route={plan.routes.find((r) => r.id === expandedRoute)!}
                recommended={expandedRoute === plan.recommended_route}
                onClose={() => setExpandedRoute(null)}
              />
            )}
            {session.loading && (
              <div className="map-status" role="status">
                <CircularProgress size={14} color="inherit" aria-hidden />
                Routing and checking forecasts at every checkpoint…
              </div>
            )}
            {!plan && !session.loading && (
              <div className="map-empty">Plan a trip to compare routes by weather risk</div>
            )}
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
