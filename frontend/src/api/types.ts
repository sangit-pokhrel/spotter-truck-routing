export type RiskKey = "low" | "moderate" | "high" | "severe" | "no_travel" | "unknown";

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export interface Checkpoint {
  mile: number;
  lat: number;
  lon: number;
  eta: string;
  hours_from_departure: number;
  coverage_mi: number;
  level: RiskKey;
  wind_mph: number | null;
  gust_mph: number | null;
  rain_in_hr: number | null;
  snow_in_hr: number | null;
  factors: string[];
}

export interface RiskSegment {
  level: RiskKey;
  coords: [number, number][];
}

export interface RouteOption {
  id: string;
  name: string;
  rank: number;
  distance_mi: number;
  duration_h: number;
  arrival: string;
  miles_by_level: Record<RiskKey, number>;
  avg_risk: number;
  max_level: RiskKey;
  segments: RiskSegment[];
  checkpoints: Checkpoint[];
}

export interface TripPlan {
  origin: Place;
  destination: Place;
  departure: string;
  load_weight_lb: number;
  interval_mi: number;
  recommended_route: string;
  recommendation_reason: string;
  routes: RouteOption[];
  corridor: [number, number][];
}

export interface PlanRequest {
  origin: Place | string;
  destination: Place | string;
  departure_time: string;
  load_weight_lb: number;
  interval_miles: 10 | 25 | 50;
}

export type HeatMetric = "risk" | "wind" | "rain" | "snow";

export interface HeatmapGrid {
  west: number;
  east: number;
  north: number;
  south: number;
  cols: number;
  rows: number;
  spacing_mi: number;
}

export interface Heatmap {
  start: string;
  hours: number;
  grid: HeatmapGrid;
  /** Flat cell index (row * cols + col, row 0 = north) for each value in a frame. */
  cells: number[];
  frames: Record<HeatMetric, (number | null)[][]>;
}
