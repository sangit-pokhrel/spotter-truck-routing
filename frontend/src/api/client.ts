import type { Heatmap, Place, PlanRequest, TripPlan } from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {}

function describe(body: unknown): string {
  if (!body || typeof body !== "object") return "Something went wrong.";
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  // DRF field errors: { field: ["message"] }
  return Object.entries(record)
    .map(([field, msgs]) => `${field.replace(/_/g, " ")}: ${Array.isArray(msgs) ? msgs.join(" ") : String(msgs)}`)
    .join(" · ");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the server. Check your connection.");
  }
  const body = await resp.json().catch(() => null);
  if (!resp.ok) throw new ApiError(describe(body));
  return body as T;
}

/** The API couldn't fetch weather itself (rate-limited): run this Open-Meteo query and resend. */
interface WeatherRequest {
  url: string;
  params: Record<string, string>;
  locations: [number, number][];
  batch_size: number;
}

const WEATHER_PARALLEL = 4;
// backoff between retries; the free tier limits calls per minute
const WEATHER_RETRY_MS = [1500, 4000];

interface WeatherItem {
  hourly: Record<string, unknown>;
  hourly_units: Record<string, string>;
}

// keyed by location and time window so re-plans reuse forecasts
const weatherCache = new Map<string, WeatherItem>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBatch(
  req: WeatherRequest,
  batch: [number, number][],
  signal?: AbortSignal,
): Promise<WeatherItem[]> {
  const query = new URLSearchParams({
    ...req.params,
    latitude: batch.map(([lat]) => lat.toFixed(4)).join(","),
    longitude: batch.map(([, lon]) => lon.toFixed(4)).join(","),
  });
  let reason: string | undefined;
  for (let attempt = 0; attempt <= WEATHER_RETRY_MS.length; attempt++) {
    if (attempt > 0) await sleep(WEATHER_RETRY_MS[attempt - 1]);
    try {
      const resp = await fetch(`${req.url}?${query}`, { signal });
      const body = await resp.json().catch(() => null);
      if (resp.ok && body) {
        const items: { hourly: Record<string, unknown>; hourly_units?: Record<string, string> }[] = Array.isArray(body)
          ? body
          : [body];
        // `time` is implied by start_hour
        return items.map(({ hourly: { time: _time, ...hourly }, hourly_units }) => ({
          hourly,
          hourly_units: hourly_units ?? {},
        }));
      }
      reason = body?.reason;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
    }
  }
  throw new ApiError(reason ?? "Weather service is busy. Please try again in a minute.");
}

async function fetchWeather(req: WeatherRequest, signal?: AbortSignal) {
  const keyOf = ([lat, lon]: [number, number]) =>
    `${lat.toFixed(4)},${lon.toFixed(4)}|${req.params.start_hour}|${req.params.end_hour}`;
  const missing = req.locations.filter((loc) => !weatherCache.has(keyOf(loc)));

  const batches: [number, number][][] = [];
  for (let i = 0; i < missing.length; i += req.batch_size) batches.push(missing.slice(i, i + req.batch_size));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const items = await fetchBatch(req, batch, signal);
      batch.forEach((loc, i) => weatherCache.set(keyOf(loc), items[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(WEATHER_PARALLEL, batches.length) }, worker));

  return {
    start_hour: req.params.start_hour,
    locations: req.locations,
    items: req.locations.map((loc) => weatherCache.get(keyOf(loc))!),
  };
}

async function postWithWeather<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const post = (payload: object) =>
    request<T | { weather_request: WeatherRequest }>(path, { method: "POST", body: JSON.stringify(payload), signal });
  const first = await post(body);
  if (first && typeof first === "object" && "weather_request" in first) {
    const weather = await fetchWeather(first.weather_request, signal);
    return (await post({ ...body, weather })) as T;
  }
  return first as T;
}

export const api = {
  geocode: (q: string, signal?: AbortSignal) =>
    request<{ results: Place[] }>(`/api/geocode/?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.results),

  plan: (body: PlanRequest, signal?: AbortSignal) => postWithWeather<TripPlan>("/api/plan/", body, signal),

  heatmap: (plan: TripPlan, signal?: AbortSignal) =>
    postWithWeather<Heatmap>(
      "/api/heatmap/",
      { corridor: plan.corridor, departure_time: plan.departure, load_weight_lb: plan.load_weight_lb },
      signal,
    ),
};
