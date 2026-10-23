import type { Checkpoint, RouteOption } from "../api/types";

export type LatLng = [number, number];

const EARTH_RADIUS_MI = 3958.8;

export function haversineMi([lat1, lon1]: LatLng, [lat2, lon2]: LatLng): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RoutePath {
  points: LatLng[];
  cum: number[];
}

/** The route as a single polyline with cumulative distances. */
export function routePath(route: RouteOption): RoutePath {
  const points: LatLng[] = [];
  route.segments.forEach((seg, i) => points.push(...(i === 0 ? seg.coords : seg.coords.slice(1))));
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineMi(points[i - 1], points[i]));
  return { points, cum };
}

function pointAtDistance({ points, cum }: RoutePath, d: number): LatLng {
  if (d <= 0) return points[0];
  if (d >= cum[cum.length - 1]) return points[points.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t];
}

/** Point at road mile `mile`. The drawn line is simplified, so it is rescaled to the road length. */
export function pointAtMile(route: RouteOption, path: RoutePath, mile: number): LatLng {
  const scale = path.cum[path.cum.length - 1] / (route.distance_mi || 1);
  return pointAtDistance(path, mile * scale);
}

/** Road mile reached `hours` after departure (from checkpoint ETAs), or null outside the trip. */
export function mileAtHour(checkpoints: Checkpoint[], hours: number): number | null {
  if (!checkpoints.length || hours < 0 || hours > checkpoints[checkpoints.length - 1].hours_from_departure) return null;
  let i = 0;
  while (i < checkpoints.length - 2 && checkpoints[i + 1].hours_from_departure < hours) i++;
  const a = checkpoints[i];
  const b = checkpoints[i + 1] ?? a;
  const span = b.hours_from_departure - a.hours_from_departure;
  return span > 0 ? a.mile + ((hours - a.hours_from_departure) / span) * (b.mile - a.mile) : a.mile;
}

/** Where the truck is `hours` after departure, or null before departure / after arrival. */
export function truckPosition(route: RouteOption, path: RoutePath, hours: number): LatLng | null {
  const mile = mileAtHour(route.checkpoints, hours);
  return mile === null ? null : pointAtMile(route, path, mile);
}

/** The checkpoint whose stretch of road contains `mile`. */
export function checkpointAtMile(checkpoints: Checkpoint[], mile: number): Checkpoint | null {
  if (!checkpoints.length) return null;
  let best = checkpoints[0];
  for (const cp of checkpoints) if (Math.abs(cp.mile - mile) < Math.abs(best.mile - mile)) best = cp;
  return best;
}
