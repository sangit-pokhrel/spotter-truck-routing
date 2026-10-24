import L from "leaflet";
import { memo, useEffect, useMemo } from "react";
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  ScaleControl,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { Checkpoint, RouteOption, TripPlan } from "../api/types";
import { BASEMAPS, type BasemapId } from "../lib/basemaps";
import { formatDuration, formatEta, formatMiles } from "../lib/format";
import { routePath, pointAtMile, type LatLng } from "../lib/geo";
import { RISK_COLOR, RISK_LABEL, ROUTE_COLORS } from "../lib/risk";
import { CheckpointDetails } from "./CheckpointDetails";

const US_CENTER: LatLng = [39.5, -98.35];
const LABEL_POSITIONS = [0.32, 0.5, 0.68]; // stagger route labels so they don't stack

export interface HeatOverlay {
  url: string;
  bounds: L.LatLngBoundsExpression;
}

export interface FocusedCheckpoint {
  cp: Checkpoint;
  routeName: string;
}

interface Props {
  plan: TripPlan | null;
  selectedId: string | null;
  onSelectRoute: (id: string) => void;
  heat: HeatOverlay | null;
  truck: LatLng | null;
  hoverPoint: LatLng | null;
  focused: FocusedCheckpoint | null;
  onFocus: (f: FocusedCheckpoint | null) => void;
  basemap: BasemapId;
  fitKey: number;
  /** Route whose summary is open. */
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  /** Summary beside the badge (desktop) rather than in the parent's card (phones). */
  inlineDetails: boolean;
}

function pin(label: string, cls: string) {
  return L.divIcon({
    className: `map-pin ${cls}`,
    html: `<span>${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}
// "O"/"D" rather than A/B so pins aren't confused with Route A/B/C.
const ORIGIN_ICON = pin("O", "pin-origin");
const DEST_ICON = pin("D", "pin-dest");
const TRUCK_ICON = L.divIcon({
  className: "truck-marker",
  html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

/** Leaflet caches the map size; re-measure when the layout changes. */
function ResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function FitToPlan({ plan, fitKey }: { plan: TripPlan | null; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!plan) return;
    map.invalidateSize({ pan: false }); // the new layout may have just resized the map
    const bounds = L.latLngBounds([]);
    plan.routes.forEach((r) => r.segments.forEach((s) => s.coords.forEach((c) => bounds.extend(c))));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48] });
  }, [plan, fitKey, map]);
  return null;
}

function FlyToFocus({ focused }: { focused: FocusedCheckpoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (focused) map.flyTo([focused.cp.lat, focused.cp.lon], Math.max(map.getZoom(), 8), { duration: 0.6 });
  }, [focused, map]);
  return null;
}

const RouteLine = memo(function RouteLine({ route, onSelect }: { route: RouteOption; onSelect: () => void }) {
  const positions = useMemo(() => route.segments.map((s) => s.coords), [route]);
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: ROUTE_COLORS[route.id], weight: 4, opacity: 0.7, lineCap: "round" }}
      eventHandlers={{
        click: onSelect,
        mouseover: (e) => e.target.setStyle({ weight: 7, opacity: 0.95 }),
        mouseout: (e) => e.target.setStyle({ weight: 4, opacity: 0.7 }),
      }}
    />
  );
});

const SelectedRoute = memo(function SelectedRoute({ route, casing }: { route: RouteOption; casing: string }) {
  const all = useMemo(() => route.segments.map((s) => s.coords), [route]);
  return (
    <>
      <Polyline positions={all} pathOptions={{ color: casing, weight: 11, opacity: 0.9 }} interactive={false} />
      <Polyline
        positions={all}
        pathOptions={{ color: ROUTE_COLORS[route.id], weight: 8, opacity: 1 }}
        interactive={false}
      />
      {route.segments.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg.coords}
          pathOptions={{ color: RISK_COLOR[seg.level], weight: 4, opacity: 1 }}
          interactive={false}
        />
      ))}
    </>
  );
});

const Checkpoints = memo(function Checkpoints({
  route,
  selected,
  onFocus,
}: {
  route: RouteOption;
  selected: boolean;
  onFocus: (f: FocusedCheckpoint) => void;
}) {
  return (
    <>
      {route.checkpoints.map((cp) => (
        <CircleMarker
          key={cp.mile}
          center={[cp.lat, cp.lon]}
          radius={selected ? 5 : 3}
          pathOptions={{
            color: selected ? "#ffffff" : RISK_COLOR[cp.level],
            weight: selected ? 1.5 : 1,
            fillColor: RISK_COLOR[cp.level],
            fillOpacity: selected ? 1 : 0.75,
            opacity: selected ? 1 : 0.75,
          }}
          eventHandlers={{ click: () => onFocus({ cp, routeName: route.name }) }}
        >
          <Tooltip direction="top" offset={[0, -6]} className="cp-tip">
            <b>
              {route.name} · mi {Math.round(cp.mile)}
            </b>{" "}
            · {formatEta(cp.eta)} · <span style={{ color: RISK_COLOR[cp.level] }}>{RISK_LABEL[cp.level]}</span>
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
});

/** A/B/C badges: tapping one selects the route and shows its summary. */
const RouteLabels = memo(function RouteLabels({
  plan,
  selectedId,
  onSelect,
  expandedId,
  onExpand,
  inlineDetails,
}: {
  plan: TripPlan;
  selectedId: string | null;
  onSelect: (id: string) => void;
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  inlineDetails: boolean;
}) {
  const positions = useMemo(
    () =>
      Object.fromEntries(
        plan.routes.map((r, i) => [
          r.id,
          pointAtMile(r, routePath(r), r.distance_mi * LABEL_POSITIONS[i % LABEL_POSITIONS.length]),
        ]),
      ),
    [plan],
  );

  const icons = useMemo(
    () =>
      Object.fromEntries(
        plan.routes.map((r) => {
          const severe = r.miles_by_level.severe + r.miles_by_level.no_travel;
          const best = r.id === plan.recommended_route;
          const classes = ["rl", best && "rl-best", r.id === selectedId && "rl-selected", severe > 0 && "rl-warn"]
            .filter(Boolean)
            .join(" ");
          const details =
            r.id === expandedId && inlineDetails
              ? `<span class="rl-details"><span>${formatDuration(r.duration_h)}</span><i></i><span>${formatMiles(r.distance_mi)}</span><i></i>` +
                `<span class="${severe > 0 ? "rl-bad" : ""}">${formatMiles(severe)} severe</span>${best ? "<em>Best</em>" : ""}</span>`
              : "";
          const title = `Route ${r.id}${best ? " (recommended)" : ""}: tap for details`;
          const html = `<span class="${classes}" style="--c:${ROUTE_COLORS[r.id]}" title="${title}"><b>${r.id}</b>${details}</span>`;
          return [r.id, L.divIcon({ className: "rl-icon", html, iconSize: [0, 0] })];
        }),
      ),
    [plan, selectedId, expandedId, inlineDetails],
  );

  return (
    <>
      {plan.routes.map((r) => (
        <Marker
          key={r.id}
          position={positions[r.id]}
          icon={icons[r.id]}
          zIndexOffset={r.id === expandedId ? 1000 : r.id === selectedId ? 900 : 800}
          eventHandlers={{
            click: () => {
              onSelect(r.id);
              onExpand(expandedId === r.id ? null : r.id);
            },
          }}
          keyboard={false}
        />
      ))}
    </>
  );
});

export function MapView({
  plan,
  selectedId,
  onSelectRoute,
  heat,
  truck,
  hoverPoint,
  focused,
  onFocus,
  basemap,
  fitKey,
  expandedId,
  onExpand,
  inlineDetails,
}: Props) {
  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null;
  const others = plan?.routes.filter((r) => r.id !== selectedId) ?? [];
  const tiles = BASEMAPS[basemap];
  const casing = basemap === "light" ? "#14181f" : "#ffffff";

  return (
    <MapContainer center={US_CENTER} zoom={4} zoomSnap={0.25} preferCanvas className={`map map-${basemap}`} zoomControl>
      <TileLayer key={tiles.id} attribution={tiles.attribution} url={tiles.base} maxZoom={16} crossOrigin="anonymous" />
      <Pane name="heatmap" style={{ zIndex: 350 }}>
        {heat && <ImageOverlay url={heat.url} bounds={heat.bounds} opacity={0.85} className="heat-image" />}
      </Pane>
      <Pane name="labels" style={{ zIndex: 450, pointerEvents: "none" }}>
        <TileLayer key={`${tiles.id}-labels`} url={tiles.labels} maxZoom={16} crossOrigin="anonymous" />
      </Pane>

      {others.map((r) => (
        <RouteLine key={r.id} route={r} onSelect={() => onSelectRoute(r.id)} />
      ))}
      {selected && <SelectedRoute route={selected} casing={casing} />}
      {others.map((r) => (
        <Checkpoints key={r.id} route={r} selected={false} onFocus={onFocus} />
      ))}
      {selected && <Checkpoints route={selected} selected onFocus={onFocus} />}

      {plan && (
        <>
          <RouteLabels
            plan={plan}
            selectedId={selectedId}
            onSelect={onSelectRoute}
            expandedId={expandedId}
            onExpand={onExpand}
            inlineDetails={inlineDetails}
          />
          <Marker position={[plan.origin.lat, plan.origin.lon]} icon={ORIGIN_ICON} title={plan.origin.label} />
          <Marker
            position={[plan.destination.lat, plan.destination.lon]}
            icon={DEST_ICON}
            title={plan.destination.label}
          />
        </>
      )}
      {hoverPoint && (
        <CircleMarker
          center={hoverPoint}
          radius={11}
          pathOptions={{ color: casing, weight: 2.5, fill: false, dashArray: "3 3" }}
          interactive={false}
        />
      )}
      {truck && <Marker position={truck} icon={TRUCK_ICON} interactive={false} zIndexOffset={1000} />}

      {focused && (
        <Popup position={[focused.cp.lat, focused.cp.lon]} eventHandlers={{ remove: () => onFocus(null) }}>
          <CheckpointDetails cp={focused.cp} routeName={focused.routeName} />
        </Popup>
      )}

      <ScaleControl position="bottomleft" imperial metric={false} />
      <ResizeWatcher />
      <FitToPlan plan={plan} fitKey={fitKey} />
      <FlyToFocus focused={focused} />
    </MapContainer>
  );
}
