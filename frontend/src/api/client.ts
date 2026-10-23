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

/** Sent by the API when its own weather fetch is rate-limited: the browser performs this
 *  Open-Meteo query (with its own IP/quota) and repeats the request with the raw data.
 *  All risk logic stays on the server. */
interface WeatherRequest {
  url: string;
  params: Record<string, string>;
  locations: [number, number][];
  batch_size: number;
}

const WEATHER_PARALLEL = 4;
const WEATHER_RETRY_MS = 1500;

async function fetchWeather(req: WeatherRequest, signal?: AbortSignal) {
  const batches: [number, number][][] = [];
  for (let i = 0; i < req.locations.length; i += req.batch_size) batches.push(req.locations.slice(i, i + req.batch_size));

  const fetchBatch = async (batch: [number, number][]) => {
    const query = new URLSearchParams({
      ...req.params,
      latitude: batch.map(([lat]) => lat.toFixed(4)).join(","),
      longitude: batch.map(([, lon]) => lon.toFixed(4)).join(","),
    });
    const attempt = async () => {
      const resp = await fetch(`${req.url}?${query}`, { signal });
      return { resp, body: await resp.json().catch(() => null) };
    };
    let { resp, body } = await attempt().catch((err) => {
      if (err.name === "AbortError") throw err;
      return { resp: null, body: null };
    });
    if (!resp?.ok || !body) {
      // One retry after a short pause smooths over per-minute rate limits and network blips.
      await new Promise((r) => setTimeout(r, WEATHER_RETRY_MS));
      ({ resp, body } = await attempt());
    }
    if (!resp?.ok || !body) throw new ApiError(body?.reason ?? "Weather service is unavailable. Please try again.");
    const items: { hourly: Record<string, unknown>; hourly_units?: Record<string, string> }[] = Array.isArray(body)
      ? body
      : [body];
    // Only the series the server reads; `time` is implied by start_hour.
    return items.map(({ hourly: { time: _time, ...hourly }, hourly_units }) => ({ hourly, hourly_units: hourly_units ?? {} }));
  };

  const results: Awaited<ReturnType<typeof fetchBatch>>[] = new Array(batches.length);
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const i = next++;
      results[i] = await fetchBatch(batches[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WEATHER_PARALLEL, batches.length) }, worker));
  return { start_hour: req.params.start_hour, locations: req.locations, items: results.flat() };
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
