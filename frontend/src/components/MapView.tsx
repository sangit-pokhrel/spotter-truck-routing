import L from "leaflet";
import { memo, useEffect, useMemo } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Marker, Pane, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import type { Checkpoint, RouteOption, TripPlan } from "../api/types";
import type { LatLng } from "../lib/geo";
import { RISK_COLOR } from "../lib/risk";
import { CheckpointDetails } from "./CheckpointDetails";

export const ROUTE_COLORS: Record<string, string> = { A: "#2563eb", B: "#0e9f8e", C: "#c026d3" };

const US_CENTER: LatLng = [39.5, -98.35];
const TILE_URL = import.meta.env.VITE_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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
  focused: FocusedCheckpoint | null;
  onFocus: (f: FocusedCheckpoint | null) => void;
}

function pin(label: string, cls: string) {
  return L.divIcon({ className: `map-pin ${cls}`, html: `<span>${label}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}
// "O"/"D" rather than A/B so pins aren't confused with Route A/B/C.
const ORIGIN_ICON = pin("O", "pin-origin");
const DEST_ICON = pin("D", "pin-dest");
const TRUCK_ICON = L.divIcon({ className: "truck-marker", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] });

function FitToPlan({ plan }: { plan: TripPlan | null }) {
  const map = useMap();
  useEffect(() => {
    if (!plan) return;
    const bounds = L.latLngBounds([]);
    plan.routes.forEach((r) => r.segments.forEach((s) => s.coords.forEach((c) => bounds.extend(c))));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  }, [plan, map]);
  return null;
}

function FlyToFocus({ focused }: { focused: FocusedCheckpoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (focused) map.flyTo([focused.cp.lat, focused.cp.lon], Math.max(map.getZoom(), 8), { duration: 0.6 });
  }, [focused, map]);
  return null;
}

/** Non-selected routes: one thin line each, in the route's identity colour. */
const RouteLine = memo(function RouteLine({ route, onSelect }: { route: RouteOption; onSelect: () => void }) {
  const positions = useMemo(() => route.segments.map((s) => s.coords), [route]);
  return (
    <Polyline
      positions={positions}
      pathOptions={{ color: ROUTE_COLORS[route.id], weight: 4, opacity: 0.55 }}
      eventHandlers={{ click: onSelect }}
    />
  );
});

/** Selected route: dark casing with the road coloured by checkpoint risk. */
const SelectedRoute = memo(function SelectedRoute({ route }: { route: RouteOption }) {
  const casing = useMemo(() => route.segments.map((s) => s.coords), [route]);
  return (
    <>
      <Polyline positions={casing} pathOptions={{ color: "#0b1f2a", weight: 9, opacity: 0.85 }} interactive={false} />
      {route.segments.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg.coords}
          pathOptions={{ color: RISK_COLOR[seg.level], weight: 5, opacity: 1 }}
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
          radius={selected ? 5.5 : 3.5}
          pathOptions={{
            color: selected ? "#ffffff" : RISK_COLOR[cp.level],
            weight: selected ? 1.5 : 1,
            fillColor: RISK_COLOR[cp.level],
            fillOpacity: selected ? 1 : 0.7,
            opacity: selected ? 1 : 0.7,
          }}
          eventHandlers={{ click: () => onFocus({ cp, routeName: route.name }) }}
        />
      ))}
    </>
  );
});

export function MapView({ plan, selectedId, onSelectRoute, heat, truck, focused, onFocus }: Props) {
  const selected = plan?.routes.find((r) => r.id === selectedId) ?? null;
  const others = plan?.routes.filter((r) => r.id !== selectedId) ?? [];

  return (
    <MapContainer center={US_CENTER} zoom={4} preferCanvas className="map" zoomControl>
      <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={19} className="basemap" />
      <Pane name="heatmap" style={{ zIndex: 350 }}>
        {heat && <ImageOverlay url={heat.url} bounds={heat.bounds} opacity={0.85} className="heat-image" />}
      </Pane>

      {others.map((r) => (
        <RouteLine key={r.id} route={r} onSelect={() => onSelectRoute(r.id)} />
      ))}
      {selected && <SelectedRoute route={selected} />}
      {others.map((r) => (
        <Checkpoints key={r.id} route={r} selected={false} onFocus={onFocus} />
      ))}
      {selected && <Checkpoints route={selected} selected onFocus={onFocus} />}

      {plan && (
        <>
          <Marker position={[plan.origin.lat, plan.origin.lon]} icon={ORIGIN_ICON} title={plan.origin.label} />
          <Marker position={[plan.destination.lat, plan.destination.lon]} icon={DEST_ICON} title={plan.destination.label} />
        </>
      )}
      {truck && <Marker position={truck} icon={TRUCK_ICON} interactive={false} zIndexOffset={1000} />}

      {focused && (
        <Popup position={[focused.cp.lat, focused.cp.lon]} eventHandlers={{ remove: () => onFocus(null) }}>
          <CheckpointDetails cp={focused.cp} routeName={focused.routeName} />
        </Popup>
      )}

      <FitToPlan plan={plan} />
      <FlyToFocus focused={focused} />
    </MapContainer>
  );
}
