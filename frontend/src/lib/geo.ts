import type { RouteOption } from "../api/types";

export type LatLng = [number, number];

const EARTH_RADIUS_MI = 3958.8;

export function haversineMi([lat1, lon1]: LatLng, [lat2, lon2]: LatLng): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The route as a single polyline with cumulative distances. */
export function routePath(route: RouteOption): { points: LatLng[]; cum: number[] } {
  const points: LatLng[] = [];
  route.segments.forEach((seg, i) => points.push(...(i === 0 ? seg.coords : seg.coords.slice(1))));
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineMi(points[i - 1], points[i]));
  return { points, cum };
}

function pointAtDistance(points: LatLng[], cum: number[], d: number): LatLng {
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

/** Where the truck is `hours` after departure, or null before departure / after arrival.
 *  Mile-vs-time comes from the checkpoint ETAs; the position is then found along the
 *  drawn polyline (rescaled, since the simplified line is slightly shorter than the road). */
export function truckPosition(route: RouteOption, path: ReturnType<typeof routePath>, hours: number): LatLng | null {
  const cps = route.checkpoints;
  if (!cps.length || hours < 0 || hours > cps[cps.length - 1].hours_from_departure) return null;
  let i = 0;
  while (i < cps.length - 2 && cps[i + 1].hours_from_departure < hours) i++;
  const a = cps[i];
  const b = cps[i + 1] ?? a;
  const span = b.hours_from_departure - a.hours_from_departure;
  const mile = span > 0 ? a.mile + ((hours - a.hours_from_departure) / span) * (b.mile - a.mile) : a.mile;
  const scale = path.cum[path.cum.length - 1] / (route.distance_mi || 1);
  return pointAtDistance(path.points, path.cum, mile * scale);
}
